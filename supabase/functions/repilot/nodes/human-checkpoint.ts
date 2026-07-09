// ---------------------------------------------------------------------------
// Human Checkpoint node (two checkpoints)
//
// Checkpoint 1 — Issue Selection:
//   Called after ranking. Uses LangGraph interrupt() to pause execution.
//   The frontend shows the ranked list, user picks one, value is
//   injected via Command(resume=...) on the next invoke.
//
// Checkpoint 2 — Diff Approval:
//   Called after code generation + review passes.
//   The frontend shows the exact diff, user approves or rejects.
//   Injects boolean via Command(resume=...).
//
// Both checkpoints are persisted via PostgresSaver so they survive
// edge function cold starts between user interactions.
// ---------------------------------------------------------------------------
import { interrupt, Command, isGraphInterrupt } from "npm:@langchain/langgraph";
import { startEvent, finishEvent, updateRun } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";

/**
 * Checkpoint 1: Show ranked issues to the user and wait for selection.
 * The frontend will call the /resume endpoint with the selected issue index.
 */
export async function humanCheckpointSelectIssue(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "human_checkpoint", "await-selection",
      "Waiting for you to select an issue from the ranked list…",
    );

    // Present the ranked list to the user via interrupt
    // The frontend reads the interrupt description and presents the UI.
    // When the user clicks, the value flows back through Command(resume=...)
    const selection = interrupt("Select an issue to work on from the ranked list.");
    const sel = selection as { selectedIndex?: number; cancelled?: boolean };

    if (sel.cancelled) {
      await finishEvent(evId, "done", { action: "cancelled" }, startedAt);
      await updateRun(state.runId, { status: "completed" });
      return {
        status: "completed",
        userCancelled: true,
        selectedIssueIndex: null,
      };
    }

    const selectedIndex = selection.selectedIndex;

    if (selectedIndex == null || selectedIndex < 0) {
      await finishEvent(evId, "error", { error: "Invalid selection" }, startedAt);
      return {
        status: "error",
        error: "Invalid issue selection",
      };
    }

    const selectedIssue = state.rankedIssues?.[selectedIndex];
    if (!selectedIssue) {
      await finishEvent(evId, "error", { error: "Selected issue not found" }, startedAt);
      return {
        status: "error",
        error: "Selected issue not found",
      };
    }

    await finishEvent(evId, "done", {
      selected: selectedIssue.issue.title,
      rank: selectedIssue.rank,
    }, startedAt);

    await updateRun(state.runId, { status: "generating" });

    return {
      status: "generating",
      selectedIssueIndex: selectedIndex,
      userCancelled: false,
    };
  } catch (err) {
    // Re-throw LangGraph interrupt signals so the runtime can handle them
    if (isGraphInterrupt(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    return { status: "error", error: msg };
  }
}

/**
 * Checkpoint 2: Show the generated diff to the user and wait for approval.
 */
export async function humanCheckpointApproveDiff(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "human_checkpoint", "await-approval",
      "Waiting for you to review and approve the generated diff…",
    );

    // Show the diff to the user via interrupt
    const approval = interrupt("Review the generated diff and approve or reject.");
    const appr = approval as { approved?: boolean; rejected?: boolean };

    const approved = appr.approved ?? !appr.rejected;

    await finishEvent(evId, "done", { approved }, startedAt);

    if (approved) {
      await updateRun(state.runId, { status: "completed" });
      return {
        status: "completed",
        diffApproved: true,
      };
    } else {
      await updateRun(state.runId, { status: "completed" });
      return {
        status: "completed",
        diffApproved: false,
      };
    }
  } catch (err) {
    if (isGraphInterrupt(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    return { status: "error", error: msg };
  }
}
