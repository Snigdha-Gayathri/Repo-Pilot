# 🤖 RepoPilot AI

> 🚧 **Work in Progress** — this project is still under active development. The core agent DAG and PR flow work end-to-end, but expect rough edges and incoming changes.

**A focused multi-agent GitHub contribution assistant — paste a repo URL, get analyzed issues, reviewed fixes, and human-approved pull requests.**

![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB) ![Supabase](https://img.shields.io/badge/Backend-Supabase%20Edge%20Functions-3ECF8E) ![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-4285F4) ![Agents](https://img.shields.io/badge/Agents-6--Agent%20DAG-6f42c1) ![License](https://img.shields.io/badge/License-MIT-green)

Paste the URL of any public GitHub repository and a team of six specialized AI agents — orchestrated in a LangGraph-style DAG and powered exclusively by the Gemini API — analyzes the codebase, hunts for issues, drafts fixes, writes tests, and reviews the work. You stay in the loop: approve every change per file or per hunk, and only when you explicitly click **Create Pull Request** does RepoPilot request GitHub access and open a PR in your account.

> Reading and analyzing public repositories requires **no login**. GitHub authentication is requested only at PR creation time via the official OAuth flow.

## Table of Contents

- [The Agent Team](#the-agent-team)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Security](#security)
- [Tech Stack](#tech-stack)

## The Agent Team

| # | Agent | Responsibility |
|---|---|---|
| 1 | **Repository Analyst** | Understands project structure, frameworks, dependencies, architecture, and coding conventions |
| 2 | **Issue Hunter** | Identifies bugs, TODOs, code smells, duplicated logic, missing docs/tests, performance issues, security risks, and beginner-friendly opportunities |
| 3 | **Solution Architect** | Proposes implementation strategies per issue — with trade-offs, complexity, risk, and confidence |
| 4 | **Code Engineer** | Generates production-quality code as a git-style diff, matching the repo's existing style; produces ≥2 independent implementations for important issues |
| 5 | **QA Agent** | Reviews generated code, flags regressions, and generates unit + integration tests |
| 6 | **Reviewer Agent** | Compares all proposals, scores each on quality and risk, selects the best implementation, and justifies the choice |

## Features

- **Live agent execution** — watch every agent step in real time, with progress, intermediate outputs, timestamps, and duration
- **Rich issue cards** — description, severity, confidence, files affected, estimated effort, suggested solutions, Reviewer recommendation
- **Git-style diffs with syntax highlighting** — review generated code exactly as you would in a real PR
- **Human-in-the-loop approval** — approve or reject changes per file or per hunk before anything is committed
- **GitHub OAuth + PR creation** — fork (if needed), branch, commit approved changes, push, and open a PR — only on explicit click
- **Never modifies a repo automatically** — RepoPilot only reads public repos until you authorize and approve

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

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (database, realtime, and edge function backend)
- A Google AI Studio Gemini API key
- *(Optional, for PR creation)* A GitHub OAuth App — client ID + secret

### Install

```bash
npm install
cp .env.example .env   # then fill in your values
```

### Run locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Environment Variables

```bash
# Frontend (safe to expose — Supabase anon key is public by design)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Backend secrets — set in your hosting provider's dashboard, NOT in the frontend bundle
# GEMINI_API_KEY=your-gemini-api-key
# GITHUB_OAUTH_CLIENT_ID=your-github-oauth-client-id
# GITHUB_OAUTH_CLIENT_SECRET=your-github-oauth-client-secret
```

Backend secrets are configured in **Supabase dashboard → Edge Functions → Secrets**:

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Required for AI reasoning |
| `GITHUB_OAUTH_CLIENT_ID` | Required only for PR creation |
| `GITHUB_OAUTH_CLIENT_SECRET` | Required only for PR creation |

## Deployment

### Netlify

The included `netlify.toml` configures the build and SPA redirects. Connect the repo, set the build command to `npm run build`, publish directory `dist`, and add the `VITE_*` env vars.

### Render

The included `render.yaml` defines a static site. Create a new Static Site on Render, connect the repo, and add the `VITE_*` env vars.

> The backend (edge function + secrets) lives in Supabase and is shared across deployments — only the frontend is deployed to Netlify/Render.

## Security

- The Gemini API key is a **server-side secret** — lives only in the Supabase edge function environment, never bundled into the frontend
- `.env` is gitignored; `.env.example` documents required variables without secrets
- GitHub OAuth is requested only at PR creation time, with the `repo` scope
- RepoPilot never modifies a repository automatically — all changes require explicit human approval

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, lucide-react |
| Backend | Supabase Edge Functions (Deno), Supabase Postgres + Realtime |
| AI | Google Gemini API (`@google/generative-ai`) |
| Orchestration | LangGraph-style agent DAG (sequential with per-issue fan-out) |

## License

MIT

## Contact

- GitHub: [Snigdha-Gayathri](https://github.com/Snigdha-Gayathri)
- LinkedIn: [snigdha-gayathri](https://linkedin.com/in/snigdha-gayathri)
