import { FileDiff } from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileAtCommitUrl } from "../lib/review";
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
      id={`${context ? "context-finding" : "finding"}-${f.id}`}
      className={cn(
        "scroll-mt-6 overflow-hidden rounded-xl border bg-sidebar",
        active && "border-ring",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <Button size="sm" variant="outline" onClick={onDiscuss}>
          Discuss finding
        </Button>
        <SeverityBadge severity={f.severity} />
        <FindingVerdictBadge verdict={verdict} />
        <a
          className="min-w-0 break-all font-mono text-xs text-muted-foreground hover:text-foreground"
          href={f.side === "LEFT" && !review.diffLeftSha ? undefined : anchor}
          target="_blank"
          rel="noopener noreferrer"
        >
          {f.path}:{f.line}
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
            <FileDiff className="size-3.5" />
            Show in diff
          </Button>
        )}
      </div>
      <div className="p-5">
        <h3 className="font-semibold">{f.title}</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
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
                  href={fileAtCommitUrl(
                    review.sourceOwner ?? review.repoOwner,
                    review.sourceRepo ?? review.repoName,
                    review.headSha ?? "",
                    e.path,
                    e.line,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-blue-300"
                >
                  {e.path}:{e.line}
                </a>
                <pre className="mt-2 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">
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
        </div>
      </div>
    </article>
  );
}
