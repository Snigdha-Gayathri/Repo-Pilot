// ---------------------------------------------------------------------------
// RepoPilot AI — HTTP handler (entry point)
//
// New architecture:
//   Instead of running a monolithic sequential pipeline, this handler
//   invokes a LangGraph StateGraph that orchestrates 8 specialized
//   agent nodes with conditional routing and human-in-the-loop checkpoints.
//
// Actions:
//   - analyze:      Start a new analysis. Creates a run, invokes the graph.
//   - resume:       Resume after an interrupt (user selected issue or approved diff).
//   - status:       Get the current graph state for a run.
// ---------------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildGraph } from "./graph.ts";
import { updateRun, getRun, getSupabase } from "./lib/supabase.ts";
import { Command } from "@langchain/langgraph";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Cache the compiled graph across invocations (warm start)
let _graphApp: Awaited<ReturnType<typeof buildGraph>> | null = null;

async function getGraph() {
  if (!_graphApp) {
    _graphApp = await buildGraph();
  }
  return _graphApp;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "analyze";

    // ── Start a new analysis ──
    if (action === "analyze") {
      const { repo_url, run_id } = await req.json();
      if (!repo_url || !run_id) {
        return new Response(JSON.stringify({ error: "repo_url and run_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { app, checkpointer, pool } = await getGraph();

      // Run graph in background (fire-and-forget via waitUntil)
      const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil ??
        ((p: Promise<unknown>) => void p.catch(() => {}));

      waitUntil(
        (async () => {
          try {
            // Insert the run row (created by frontend with status=pending, update to indexing)
            const supa = getSupabase();
            await supa.from("analysis_runs").update({
              repo_url,
              status: "indexing",
            }).eq("id", run_id);

            const config = { configurable: { thread_id: run_id } };

            // Initial invocation — graph will run until the first interrupt
            const initialInput = {
              runId: run_id,
              repoUrl: repo_url,
              status: "pending" as const,
              githubToken: Deno.env.get("GITHUB_TOKEN") ?? null,
            };

            // Run graph until interrupt — result is not needed by the client
            // since the frontend polls the DB and the /status endpoint.
            await app.invoke(initialInput, config);
          } catch (err) {
            console.error("Graph execution error:", err);
            try {
              await updateRun(run_id, { status: "error", error: String(err) });
            } catch { /* ignore cleanup errors */ }
          } finally {
            // Don't close the pool — it's reused across invocations
          }
        })(),
      );

      return new Response(JSON.stringify({ ok: true, run_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resume after a human-in-the-loop interrupt ──
    if (action === "resume") {
      const { run_id, command } = await req.json();
      if (!run_id || !command) {
        return new Response(JSON.stringify({ error: "run_id and command required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { app, checkpointer, pool } = await getGraph();
      const config = { configurable: { thread_id: run_id } };

      try {
        // Resume the graph with the user's command
        await app.invoke(new Command({ resume: command }), config);

        // Get the final state
        const finalState = await app.getState(config);

        return new Response(JSON.stringify({
          ok: true,
          status: finalState.values.status,
          state: finalState.values,
          interrupts: finalState.tasks?.[0]?.interrupts ?? [],
          next: finalState.next,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Get graph state for a run ──
    if (action === "status") {
      const runId = url.searchParams.get("run_id");
      if (!runId) {
        return new Response(JSON.stringify({ error: "run_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { app } = await getGraph();
      const config = { configurable: { thread_id: runId } };

      try {
        const state = await app.getState(config);
        return new Response(JSON.stringify({
          ok: true,
          status: state.values.status,
          state: state.values,
          interrupts: state.tasks?.[0]?.interrupts ?? [],
          next: state.next,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        // Graph may not have started yet — fall back to DB
        const run = await getRun(runId);
        return new Response(JSON.stringify({
          ok: !!run,
          status: run?.status ?? "unknown",
          state: run ?? null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
