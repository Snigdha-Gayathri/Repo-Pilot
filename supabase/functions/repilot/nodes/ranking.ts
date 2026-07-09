// ---------------------------------------------------------------------------
// Ranking Agent node
// Responsibilities:
//   1. Score each discovered issue on impact, difficulty, acceptance likelihood
//   2. Rank them by overall contribution-worthiness
//   3. Provide rationale per item
// ---------------------------------------------------------------------------
import { geminiJSON } from "../lib/gemini.ts";
import { startEvent, finishEvent } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";
import type { DiscoveredIssue, RankedIssue, RepoAnalysis } from "../types.ts";
import { insertIssues } from "../lib/supabase.ts";

const SYSTEM_BASE =
  "You are the Ranking Agent in RepoPilot AI. Your job is to score and rank candidate issues by their contribution-worthiness. Always respond with valid JSON.";

export async function rankingAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "ranking", "score",
      `Scoring and ranking ${state.discoveredIssues.length} candidate issues…`,
    );
    if (state.discoveredIssues.length === 0) {
      await finishEvent(evId, "done", { ranked: 0 }, startedAt);
      return { rankedIssues: [] };
    }

    const repoAnalysis = state.repoAnalysis!;

    const prompt = `You are the Ranking Agent. Score each candidate issue below on four axes (0-100), then produce a weighted overall score and a ranked shortlist.

Repository context:
- Name: ${state.repoInfo?.fullName}
- Description: ${state.repoInfo?.description}
- Stars: ${state.repoInfo?.stars}
- Languages: ${repoAnalysis.languages?.join(", ")}
- Testing: ${repoAnalysis.conventions?.testing ?? "unknown"}
${repoAnalysis.qualitySignals?.hasTests ? "- Has existing tests" : "- No tests detected"}
${repoAnalysis.qualitySignals?.hasCi ? "- Has CI configured" : "- No CI detected"}

Ranking axes:
- impact (0-100): How much does fixing this improve the project?
- difficulty (0-100): How hard is it to implement? Higher = harder.
- acceptanceLikelihood (0-100): How likely is a maintainer to accept this PR?
- alignmentWithGuidelines (0-100): How well does this align with contribution guidelines?

Overall score = (impact * 0.35) + ((100 - difficulty) * 0.25) + (acceptanceLikelihood * 0.25) + (alignmentWithGuidelines * 0.15)

Candidate issues:
${JSON.stringify(state.discoveredIssues.map((i, idx) => ({ index: idx, title: i.title, description: i.description.slice(0, 300), severity: i.severity, category: i.category, confidence: i.confidence })), null, 2)}

Return JSON: { "rankedIssues": [ { "issueIndex": 0-based index, "scores": { "impact": number, "difficulty": number, "acceptanceLikelihood": number, "alignmentWithGuidelines": number }, "overallScore": number, "rationale": "why this ranking" } ] }
Order rankedIssues by overallScore descending.`;

    const result = await geminiJSON<{ rankedIssues: any[] }>(prompt, SYSTEM_BASE);

    const ranked: RankedIssue[] = (result.rankedIssues ?? [])
      .filter((r: any) => r.issueIndex >= 0 && r.issueIndex < state.discoveredIssues.length)
      .map((r: any, rank: number) => ({
        issue: state.discoveredIssues[r.issueIndex],
        rank: rank + 1,
        scores: {
          impact: r.scores?.impact ?? 50,
          difficulty: r.scores?.difficulty ?? 50,
          acceptanceLikelihood: r.scores?.acceptanceLikelihood ?? 50,
          alignmentWithGuidelines: r.scores?.alignmentWithGuidelines ?? 50,
        },
        overallScore: r.overallScore ?? 0,
        rationale: r.rationale ?? "",
      }));

    // Persist issues to Supabase so the frontend can read them
    await insertIssues(
      state.runId,
      ranked.map((r) => ({
        title: r.issue.title,
        description: r.issue.description,
        category: r.issue.category,
        severity: r.issue.severity,
        confidence: r.issue.confidence,
        files_affected: r.issue.filesAffected,
        estimated_effort: r.issue.estimatedEffort,
        is_important: r.issue.isImportant,
      })),
    );

    await finishEvent(evId, "done", {
      ranked: ranked.length,
      topIssue: ranked[0]?.issue.title ?? "none",
    }, startedAt);

    return { rankedIssues: ranked };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    return { error: msg, status: "error" as const };
  }
}
