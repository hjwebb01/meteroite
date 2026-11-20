import { Disclosure, DisclosureSummary } from "@/components/ui/disclosure";
import { useEffect, useRef } from "react";
import Check from "@boxicons/react/Check";
import Clock from "@boxicons/react/Clock";
import File from "@boxicons/react/File";
import Folder from "@boxicons/react/Folder";
import GitCompare from "@boxicons/react/GitCompare";
import Search from "@boxicons/react/Search";
import Square from "@boxicons/react/Square";
import TriangleAlert from "@boxicons/react/AlertTriangle";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { ActivityRow } from "../lib/review-activity";
import { formatElapsed } from "../lib/review-stage";

type StageRow = Extract<ActivityRow, { kind: "stage" }>;
type ToolRow = Extract<ActivityRow, { kind: "tool" }>;

const TOOL_ICONS: Record<string, typeof File> = {
  readFile: File,
  searchText: Search,
  listFiles: Folder,
  getChangedLines: GitCompare,
};

function StageIcon({ state }: { state: StageRow["state"] }) {
  const common = "size-4 shrink-0";
  switch (state) {
    case "done":
      return <Check aria-hidden="true" className={common} />;
    case "failed":
      return <TriangleAlert aria-hidden="true" className={common} />;
    case "cancelled":
      return <Square aria-hidden="true" className={common} />;
    case "pending":
      return (
        <span
          aria-hidden="true"
          className={cn(common, "flex items-center justify-center")}
        >
          <StatusDot />
        </span>
      );
    case "queued":
      return <Clock aria-hidden="true" className={common} />;
    case "active":
      return <Spinner aria-hidden="true" />;
  }
}

function StageItem({ row }: { row: StageRow }) {
  const stopped = row.state === "failed" || row.state === "cancelled";
  return (
    <li
      className={cn(
        "flex items-center gap-3 font-medium",
        row.state === "pending" ? "text-review-muted" : "text-review-body",
      )}
    >
      <StageIcon state={row.state} />
      <span className="min-w-0 break-words">{row.label}</span>
      {stopped && <span className="text-review-muted">· {row.state}</span>}
    </li>
  );
}

function ToolItem({
  row,
  startedAt,
  onOpen,
}: {
  row: ToolRow;
  startedAt?: number;
  onOpen?: (target: NonNullable<ToolRow["target"]>) => void;
}) {
  const Icon = TOOL_ICONS[row.tool] ?? File;
  const target = row.target;
  const text = <span className="min-w-0 break-words">{row.text}</span>;
  return (
    <li
      className={cn(
        "ml-2.5 flex items-start gap-3 border-l border-review-border pl-5 font-mono text-xs leading-5",
        row.state === "active" ? "text-review-body" : "text-review-muted",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {target && onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(target)}
          className="min-w-0 break-words text-left text-review-link underline-offset-4 hover:underline"
        >
          {row.text}
          {target.start ? ` (lines ${target.start}–${target.end})` : ""}
        </button>
      ) : (
        text
      )}
      {row.at !== undefined && startedAt !== undefined && (
        <span className="ml-auto shrink-0 tabular-nums text-review-muted">
          +{formatElapsed(row.at - startedAt)}
        </span>
      )}
      {row.state === "active" && (
        <span
          aria-hidden="true"
          className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-review-link motion-reduce:animate-none"
        />
      )}
      {row.state === "stopped" && (
        <span className="ml-auto shrink-0 text-review-muted">stopped</span>
      )}
    </li>
  );
}

export function ReviewActivityFeed({
  rows,
  live,
  collapsed = false,
  startedAt,
  onOpen,
}: {
  rows: ActivityRow[];
  live: boolean;
  collapsed?: boolean;
  startedAt?: number;
  onOpen?: (target: NonNullable<ToolRow["target"]>) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (live && list && following.current) list.scrollTop = list.scrollHeight;
  }, [rows.length, live]);

  const list = (
    <div
      ref={listRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="mt-6 max-h-96 overflow-y-auto pr-2"
    >
      <ol aria-label="Analysis steps" className="space-y-3">
        {rows.map((row) =>
          row.kind === "stage" ? (
            <StageItem key={row.key} row={row} />
          ) : (
            <ToolItem
              key={row.key}
              row={row}
              startedAt={startedAt}
              onOpen={onOpen}
            />
          ),
        )}
      </ol>
    </div>
  );
  if (!collapsed) return list;
  const calls = rows.filter((row) => row.kind === "tool").length;
  return (
    <Disclosure>
      <DisclosureSummary className="text-sm text-review-muted">
        Analysis steps · {calls} {calls === 1 ? "tool call" : "tool calls"}
      </DisclosureSummary>
      {list}
    </Disclosure>
  );
}
