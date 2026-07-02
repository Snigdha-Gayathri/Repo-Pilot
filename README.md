# RepoPilot AI

A focused **multi-agent GitHub contribution assistant**. Paste the URL of any public GitHub repository and a team of six specialized AI agents — orchestrated in a LangGraph-style DAG and powered exclusively by the **Gemini API** — analyzes the codebase, hunts for issues, drafts fixes, writes tests, and reviews the work. You stay in the loop: approve every change per file or per hunk, and only when you explicitly click **Create Pull Request** does RepoPilot request GitHub access and open a PR in your account.

> Reading and analyzing public repositories requires **no login**. GitHub authentication is requested only at PR creation time via the official OAuth flow.

## The agent team

| # | Agent | Responsibility |
|---|-------|----------------|
| 1 | **Repository Analyst** | Understands project structure, frameworks, dependencies, architecture, and coding conventions. |
| 2 | **Issue Hunter** | Identifies bugs, TODOs, code smells, duplicated logic, missing docs/tests, performance issues, security risks, and beginner-friendly opportunities. |
| 3 | **Solution Architect** | Proposes one or more implementation strategies per issue — with trade-offs, complexity, risk, and confidence. |
| 4 | **Code Engineer** | Generates production-quality code as a git-style diff, matching the repo's existing style. Produces **≥2 independent implementations** for important issues. |
| 5 | **QA Agent** | Reviews generated code, flags regressions, and generates unit + integration tests. |
| 6 | **Reviewer Agent** | Compares all proposals, scores each on quality and risk, selects the best implementation, and justifies the choice. |

## Features

- **Live agent execution** — watch every agent step in real time with progress, intermediate outputs, timestamps, and execution duration.
- **Rich issue cards** — each issue shows description, severity, confidence, files affected, estimated effort, suggested solutions, and the Reviewer's recommendation.
- **Git-style diffs with syntax highlighting** — review generated code exactly as you would in a real PR.
- **Human-in-the-loop approval** — approve or reject changes **per file or per hunk** before anything is committed.
- **GitHub OAuth + PR creation** — fork (if needed), branch, commit approved changes, push, and open a pull request — only on your explicit click.
- **Never modifies a repo automatically** — RepoPilot only reads public repos until you authorize and approve.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)                     │
│  Landing → Analysis → Live timeline → Issue cards        │
│  → Diff viewer (approve/reject) → Create PR modal        │
└───────────────┬─────────────────────────────────────────┘
                │ Supabase JS client (anon key, realtime)
┌───────────────▼─────────────────────────────────────────┐
│  Supabase                                                │
│  ├─ Postgres: analysis_runs, issues, agent_events,       │
│  │            proposals, pr_requests  (RLS-enabled)       │
│  └─ Edge Function: `repilot`                              │
│       ├─ Indexes repo via GitHub tree API (no auth)        │
│       ├─ Runs 6-agent DAG with Gemini API                  │
│       ├─ Streams events to Postgres (realtime to UI)       │
│       └─ GitHub OAuth + fork/branch/commit/PR             │
└──────────────────────────────────────────────────────────┘
```

All AI reasoning uses **only the Gemini API** (`gemini-2.5-flash`). The API key is a server-side secret stored in the Supabase Edge Function environment — never exposed to the frontend.

## Getting started

### Prerequisites

- Node.js 20+
- A Supabase project (the app uses Supabase for the database, realtime, and the edge function backend)
- A Google AI Studio **Gemini API key**
- (Optional, for PR creation) A **GitHub OAuth App** — client ID + secret

### Install

```bash
npm install
cp .env.example .env   # then fill in your values
```

### Environment variables

Create a `.env` file (see `.env.example`):

```bash
# Frontend (safe to expose — Supabase anon key is public by design)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Backend secrets — set these in your hosting provider's dashboard, NOT in the frontend bundle.
# GEMINI_API_KEY=your-gemini-api-key
# GITHUB_OAUTH_CLIENT_ID=your-github-oauth-client-id
# GITHUB_OAUTH_CLIENT_SECRET=your-github-oauth-client-secret
```

### Configure backend secrets

The edge function reads `GEMINI_API_KEY` from the Supabase edge function secrets. Set it in the **Supabase dashboard → Edge Functions → Secrets**:

- `GEMINI_API_KEY` — your Gemini API key (required for AI reasoning)
- `GITHUB_OAUTH_CLIENT_ID` — GitHub OAuth app client ID (required only for PR creation)
- `GITHUB_OAUTH_CLIENT_SECRET` — GitHub OAuth app client secret (required only for PR creation)

### Run locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Deployment

### Netlify

The included `netlify.toml` configures the build and SPA redirects. Connect the repo in Netlify, set the build command to `npm run build` and publish directory to `dist`. Add the `VITE_*` env vars in Netlify's environment settings.

### Render

The included `render.yaml` defines a static site. Create a new Static Site on Render, connect the repo, and it will use the config automatically. Add the `VITE_*` env vars in Render's environment settings.

> **Note:** The backend (edge function + secrets) lives in Supabase and is shared across deployments. Only the frontend is deployed to Netlify/Render.

## Security

- The Gemini API key is a **server-side secret** — it lives only in the Supabase edge function environment and is never bundled into the frontend.
- `.env` is gitignored; `.env.example` documents the required variables without secrets.
- GitHub OAuth is requested **only** at PR creation time with the `repo` scope.
- RepoPilot **never** modifies a repository automatically — all changes require explicit human approval.

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, lucide-react
- **Backend:** Supabase Edge Functions (Deno), Supabase Postgres + Realtime
- **AI:** Google Gemini API (`@google/generative-ai`)
- **Orchestration:** LangGraph-style agent DAG (sequential with per-issue fan-out)

## License

MIT
