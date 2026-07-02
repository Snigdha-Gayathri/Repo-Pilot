/*
# RepoPilot AI — core schema

1. Purpose
RepoPilot AI analyzes a public GitHub repository with a team of six AI agents
(Repository Analyst, Issue Hunter, Solution Architect, Code Engineer, QA Agent,
Reviewer Agent) and produces reviewed, human-approved changes ready for a pull
request. This migration stores analysis runs, the issues each run discovers, the
agent execution timeline (live progress), and the proposed code changes.

2. Tables
- `analysis_runs` — one row per "analyze this repo" request. Holds the repo URL,
  clone/index status, the repository analyst summary, and overall run state.
- `issues` — one row per issue found by the Issue Hunter. Holds description,
  severity, confidence, affected files, estimated effort, suggested solutions,
  and the Reviewer's recommendation. Linked to a run.
- `agent_events` — append-only timeline of every agent step (start/progress/output/
  done/error) with timestamps and duration. Powers the live execution view.
- `proposals` — one or more implementation proposals per issue, each with generated
  code (as unified diff), tests, and the reviewer's evaluation. For important
  issues there are >=2 independent implementations.
- `pr_requests` — records a Create-Pull-Request action: the GitHub user it was
  opened for, fork/branch/PR URLs, and status. Created only after explicit user
  approval.

3. Security
- This is a no-auth app for analysis (anyone can paste a public repo URL and watch
  the agents run). GitHub OAuth is requested ONLY at PR creation time and is not
  a Supabase auth session. Therefore all tables use `TO anon, authenticated`
  policies so the anon-key frontend can read/write its own analysis data.
- RLS enabled on every table. Four CRUD policies per table (select/insert/update/
  delete), no `FOR ALL`.
- `USING (true)` / `WITH CHECK (true)` is acceptable here because analysis data is
  intentionally public/shared (single-tenant, no per-user isolation). PR request
  rows are scoped by the GitHub login captured at PR time but remain readable so
  the user can view the result.

4. Notes
- All timestamps are timestamptz defaulting to now().
- JSONB columns store structured agent payloads (severity, confidence, files, etc.).
- Indexes added on foreign keys and frequently filtered columns (run_id, issue_id).
*/

CREATE TABLE IF NOT EXISTS analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url text NOT NULL,
  repo_full_name text,
  default_branch text,
  status text NOT NULL DEFAULT 'pending',
  summary jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_analysis_runs" ON analysis_runs;
CREATE POLICY "anon_select_analysis_runs" ON analysis_runs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_analysis_runs" ON analysis_runs;
CREATE POLICY "anon_insert_analysis_runs" ON analysis_runs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_analysis_runs" ON analysis_runs;
CREATE POLICY "anon_update_analysis_runs" ON analysis_runs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_analysis_runs" ON analysis_runs;
CREATE POLICY "anon_delete_analysis_runs" ON analysis_runs FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  category text,
  severity text,
  confidence numeric,
  files_affected jsonb DEFAULT '[]'::jsonb,
  estimated_effort text,
  suggested_solutions jsonb DEFAULT '[]'::jsonb,
  reviewer_recommendation jsonb,
  is_important boolean DEFAULT false,
  selected_proposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_issues" ON issues;
CREATE POLICY "anon_select_issues" ON issues FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_issues" ON issues;
CREATE POLICY "anon_insert_issues" ON issues FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_issues" ON issues;
CREATE POLICY "anon_update_issues" ON issues FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_issues" ON issues;
CREATE POLICY "anon_delete_issues" ON issues FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  agent text NOT NULL,
  phase text,
  status text NOT NULL DEFAULT 'running',
  message text,
  output jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_ms integer
);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_agent_events" ON agent_events;
CREATE POLICY "anon_select_agent_events" ON agent_events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_agent_events" ON agent_events;
CREATE POLICY "anon_insert_agent_events" ON agent_events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_agent_events" ON agent_events;
CREATE POLICY "anon_update_agent_events" ON agent_events FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_agent_events" ON agent_events;
CREATE POLICY "anon_delete_agent_events" ON agent_events FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  approach text NOT NULL,
  tradeoffs jsonb DEFAULT '[]'::jsonb,
  complexity text,
  risk text,
  confidence numeric,
  diff text,
  files jsonb DEFAULT '[]'::jsonb,
  tests text,
  qa_notes jsonb,
  reviewer_score numeric,
  reviewer_notes text,
  is_selected boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_proposals" ON proposals;
CREATE POLICY "anon_select_proposals" ON proposals FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_proposals" ON proposals;
CREATE POLICY "anon_insert_proposals" ON proposals FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_proposals" ON proposals;
CREATE POLICY "anon_update_proposals" ON proposals FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_proposals" ON proposals;
CREATE POLICY "anon_delete_proposals" ON proposals FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS pr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  github_login text,
  fork_url text,
  branch_name text,
  pr_url text,
  pr_number integer,
  status text NOT NULL DEFAULT 'pending',
  error text,
  approved_files jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pr_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_pr_requests" ON pr_requests;
CREATE POLICY "anon_select_pr_requests" ON pr_requests FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_pr_requests" ON pr_requests;
CREATE POLICY "anon_insert_pr_requests" ON pr_requests FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_pr_requests" ON pr_requests;
CREATE POLICY "anon_update_pr_requests" ON pr_requests FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_pr_requests" ON pr_requests;
CREATE POLICY "anon_delete_pr_requests" ON pr_requests FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_issues_run_id ON issues(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id);
CREATE INDEX IF NOT EXISTS idx_proposals_issue_id ON proposals(issue_id);
CREATE INDEX IF NOT EXISTS idx_proposals_run_id ON proposals(run_id);
CREATE INDEX IF NOT EXISTS idx_pr_requests_run_id ON pr_requests(run_id);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_analysis_runs_updated ON analysis_runs;
CREATE TRIGGER trg_analysis_runs_updated BEFORE UPDATE ON analysis_runs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_pr_requests_updated ON pr_requests;
CREATE TRIGGER trg_pr_requests_updated BEFORE UPDATE ON pr_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
