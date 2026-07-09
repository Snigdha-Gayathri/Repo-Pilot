/*
# RepoPilot AI — LangGraph checkpointer tables

1. Purpose
The LangGraph multi-agent system uses `PostgresSaver` from
`@langchain/langgraph-checkpoint-postgres` to persist graph execution state
across serverless edge function invocations. This is what makes human-in-the-loop
checkpoints survive between the user seeing the ranked issue list and clicking
their selection hours later.

These tables are created at runtime by `PostgresSaver.setup()`, but this
migration makes them explicit — ensuring the schema is version-controlled and
doesn't rely on runtime DDL permissions.

2. Tables
- `checkpoint_migrations` — schema version tracking for PostgresSaver internal
  migrations. Contains a single row per applied migration version.
- `checkpoints` — stores graph state snapshots at each checkpoint (including
  interrupts). Keyed by thread_id + checkpoint_ns + checkpoint_id.
- `checkpoint_blobs` — stores large binary objects (channel values) associated
  with checkpoints.
- `checkpoint_writes` — append-only log of state writes during graph execution.
  Used for replay and resumption.

3. Security
- These tables are internal to LangGraph and accessed only by the edge function
  via the Supabase service role key. They should NOT be exposed to anon users.
- No RLS policies are created — the service role bypasses RLS.
- No triggers are needed — LangGraph manages timestamps internally.

4. Notes
- All tables use TEXT primary keys (not UUIDs) because LangGraph generates its
  own IDs (thread_id, checkpoint_id, etc.).
- Binary data (checkpoint, blob) uses BYTEA columns for serialized state.
- The composite primary keys are designed for efficient lookups by thread_id,
  which maps to our analysis_runs.id in the application layer.
*/

-- ── checkpoint_migrations ──
CREATE TABLE IF NOT EXISTS checkpoint_migrations (
  v INTEGER PRIMARY KEY
);

-- ── checkpoints ──
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BYTEA,
  metadata BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- ── checkpoint_blobs ──
CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

-- ── checkpoint_writes ──
CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  writer TEXT NOT NULL DEFAULT '',
  task_path_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- ── Indexes for common query patterns ──
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id ON checkpoints(thread_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_writes_thread_id ON checkpoint_writes(thread_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_blobs_thread_id ON checkpoint_blobs(thread_id);
