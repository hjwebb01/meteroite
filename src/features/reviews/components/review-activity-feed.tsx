import { Disclosure, DisclosureSummary } from "@/components/ui/disclosure";
import { Fragment, useEffect, useRef } from "react";
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
import {
  type ActivitySection,
  type StageRow,
  type ToolRow,
} from "../lib/review-activity";
import { formatElapsed } from "../lib/review-stage";

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
    <li className="ml-2.5 flex items-start gap-3 border-l border-review-border pl-5 font-mono text-xs leading-5 text-review-muted">
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {row.entries.length > 1 ? (
        <Disclosure className="min-w-0">
          <DisclosureSummary>{row.text}</DisclosureSummary>
          <ul className="mt-2 space-y-1">
            {row.entries.map((entry, index) => (
              <li key={row.calls[index]}>
                {entry.path && onOpen ? (
                  <button
                    type="button"
                    className="break-words text-left text-review-link hover:underline"
                    onClick={() =>
                      onOpen({
                        path: entry.path!,
                        start: entry.start,
                        end: entry.end,
                      })
                    }
                  >
                    {entry.text}
                  </button>
                ) : (
                  entry.text
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : target && onOpen ? (
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
    </li>
  );
}

export function ReviewActivityFeed({
  sections,
  live,
  collapsed = false,
  startedAt,
  onOpen,
}: {
  sections: ActivitySection[];
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
  }, [sections, live]);

  const renderTool = (row: ToolRow) => (
    <ToolItem key={row.key} row={row} startedAt={startedAt} onOpen={onOpen} />
  );

  const list = (
    <div
      ref={listRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      tabIndex={0}
      role="region"
      aria-label="Analysis activity"
      className="mt-6 max-h-96 overflow-y-auto pr-2 focus-visible:outline-1 focus-visible:outline-review-link"
    >
      <ol aria-label="Analysis steps" className="space-y-3">
        {sections.map((section) => (
          <Fragment key={section.stage.key}>
            <StageItem row={section.stage} />
            {section.tools.length > 0 &&
              (section.stage.state === "done" && !live ? (
                <li className="ml-2.5 border-l border-review-border pl-5">
                  <Disclosure>
                    <DisclosureSummary className="text-xs text-review-muted">
                      {section.tools.length}{" "}
                      {section.tools.length === 1 ? "step" : "steps"}
                    </DisclosureSummary>
                    <ol className="mt-3 space-y-3">
                      {section.tools.map(renderTool)}
                    </ol>
                  </Disclosure>
                </li>
              ) : (
                section.tools.map(renderTool)
              ))}
          </Fragment>
        ))}
      </ol>
    </div>
  );
  if (!collapsed) return list;
  const calls = sections.reduce(
    (count, section) =>
      count +
      section.tools.reduce((total, tool) => total + tool.calls.length, 0),
    0,
  );
  return (
    <Disclosure>
      <DisclosureSummary className="text-sm text-review-muted">
        Analysis steps · {calls} {calls === 1 ? "tool call" : "tool calls"}
      </DisclosureSummary>
      {list}
    </Disclosure>
  );
}
