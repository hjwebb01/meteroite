import { useId, useState } from "react";
import Check from "@boxicons/react/Check";
import Copy from "@boxicons/react/Copy";
import FileDiff from "@boxicons/react/FileCode";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileAtCommitUrl } from "../lib/review";
import {
  CATEGORY_LABEL,
  findingAgentPrompt,
} from "../lib/finding-presentation";
import { SeverityBadge } from "./severity-badge";
import {
  FindingVerdictBadge,
  type FindingVerdict,
} from "./finding-verdict-badge";

type Review = Doc<"reviews">;
type Finding = NonNullable<Review["result"]>["findings"][number];

export function FindingCard({
  finding: f,
  verdict,
  review,
  active,
  onShowInDiff,
  onDiscuss,
  context = false,
}: {
  finding: Finding;
  verdict?: FindingVerdict;
  review: Review;
  active: boolean;
  onShowInDiff?: () => void;
  onDiscuss: () => void;
  context?: boolean;
}) {
  const articleId = useId();
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "failed">("");
  const copyPrompt = () => {
    void navigator.clipboard
      .writeText(findingAgentPrompt(f, review))
      .then(() => setCopyStatus("copied"))
      .catch(() => setCopyStatus("failed"));
  };
  const anchor = fileAtCommitUrl(
    f.side === "LEFT"
      ? review.repoOwner
      : (review.sourceOwner ?? review.repoOwner),
    f.side === "LEFT"
      ? review.repoName
      : (review.sourceRepo ?? review.repoName),
    (f.side === "LEFT" ? review.diffLeftSha : review.headSha) ?? "",
    f.anchorPath ?? f.path,
    f.line,
  );
  return (
    <article
      id={articleId}
      className={cn(
        "scroll-mt-6 overflow-hidden rounded-md border bg-review-bg",
        active && "border-review-link",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        {!context && (
          <Button size="sm" variant="outline" onClick={onDiscuss}>
            Discuss finding
          </Button>
        )}
        <SeverityBadge severity={f.severity} />
        {f.category && (
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {CATEGORY_LABEL[f.category]}
          </span>
        )}
        {f.confidence && (
          <span className="shrink-0 text-xs text-muted-foreground">
            Reviewer confidence {f.confidence}/5
          </span>
        )}
        <FindingVerdictBadge verdict={verdict} />
        <a
          className="min-w-0 break-all text-xs text-muted-foreground hover:text-foreground"
          href={f.side === "LEFT" && !review.diffLeftSha ? undefined : anchor}
          target="_blank"
          rel="noopener noreferrer"
        >
          <code>
            {f.path}:{f.line}
          </code>
          {f.side === "LEFT" &&
            (review.diffLeftSha
              ? " (removed)"
              : " (removed; source ancestor unavailable)")}
        </a>
        {f.previousFindingId && (
          <span className="text-xs text-muted-foreground">
            Reported previously
          </span>
        )}
        {onShowInDiff && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={onShowInDiff}
          >
            <FileDiff aria-hidden="true" className="size-3.5" />
            Show in diff
          </Button>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-serif text-[19px] leading-tight tracking-[-0.01em]">
          {f.title}
        </h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-review-body">
          {f.explanation}
        </p>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Source evidence
          </summary>
          <div className="mt-3 space-y-3">
            {f.evidence.map((e, i) => (
              <div key={i}>
                <a
                  href={
                    (e.commitSha ?? review.headSha)
                      ? fileAtCommitUrl(
                          e.commitSha && e.commitSha === review.diffLeftSha
                            ? review.repoOwner
                            : (review.sourceOwner ?? review.repoOwner),
                          e.commitSha && e.commitSha === review.diffLeftSha
                            ? review.repoName
                            : (review.sourceRepo ?? review.repoName),
                          e.commitSha ?? review.headSha ?? "",
                          e.path,
                          e.line,
                        )
                      : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-xs text-review-link"
                >
                  <code>
                    {e.path}:{e.line}
                  </code>
                  {` · revision ${(e.commitSha ?? review.headSha)?.slice(0, 7) ?? "unavailable"}`}
                </a>
                <pre className="mt-2 overflow-x-auto rounded-md bg-background p-3 text-xs">
                  <code>{e.quote}</code>
                </pre>
              </div>
            ))}
          </div>
        </details>
        <div className="mt-5 border-t pt-4">
          <p className="text-xs font-medium text-foreground">Suggested fix</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {f.suggestion}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="xs" variant="outline" onClick={copyPrompt}>
              {copyStatus === "copied" ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <Copy aria-hidden="true" className="size-3.5" />
              )}
              Copy prompt for AI agent
            </Button>
            <span role="status" className="text-xs text-muted-foreground">
              {copyStatus === "copied" && "Prompt copied."}
              {copyStatus === "failed" &&
                "Unable to copy the prompt. Try again."}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
