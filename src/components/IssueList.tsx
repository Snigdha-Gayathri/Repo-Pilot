import { useState } from "react";
import type { Issue } from "../lib/types";
import { IssueCard } from "./IssueCard";

export function IssueList({ runId, issues }: { runId: string; issues: Issue[] }) {
  const [openId, setOpenId] = useState<string | null>(issues[0]?.id ?? null);

  // keep a valid open id as issues stream in
  const effectiveOpen = openId && issues.some((i) => i.id === openId) ? openId : issues[0]?.id ?? null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          Issues found
          <span className="ml-2 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-ink-300">
            {issues.length}
          </span>
        </h2>
      </div>
      <div className="space-y-3">
        {issues.map((issue, i) => (
          <IssueCard
            key={issue.id}
            runId={runId}
            issue={issue}
            index={i}
            open={effectiveOpen === issue.id}
            onToggle={() =>
              setOpenId((cur) => (cur === issue.id ? null : issue.id))
            }
          />
        ))}
      </div>
    </div>
  );
}
