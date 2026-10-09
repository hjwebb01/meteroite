"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  GitPullRequest,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  SearchCode,
  Square,
  TriangleAlert,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CODING_MODEL_ID } from "../../../../convex/lib/coding_models";
import {
  REVIEW_MODELS,
  chatGPTReviewModelId,
} from "../../../../convex/lib/review_models";
import { useChatGPT } from "@/features/chatgpt/hooks/use-chatgpt";
import { ChatGPTProvider } from "@/features/chatgpt/components/chatgpt-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parsePullRequestUrl } from "../lib/review";
import { ReviewFindingPanel } from "./review-finding-panel";
import { FindingCard } from "./finding-card";
import {
  isNitpick,
  severityCounts,
  sortFindings,
} from "../lib/finding-presentation";
import type { ReviewNavigationTarget } from "../lib/review-diff";
import { ReviewReassessment } from "./review-reassessment";
import { ReviewNavigation } from "./review-navigation";
import { fileCoverageGaps } from "../../../../convex/lib/review_navigation";
import { ReviewHotspots } from "./review-hotspots";
import { ReviewAssessment } from "./review-assessment";

// Pierre renders into custom elements and Shiki, so it loads only in the browser.
const ReviewDiffPanel = dynamic(() => import("./review-diff-panel"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-5 text-sm text-muted-foreground">
      Loading diff…
    </p>
  ),
});

type Availability = {
  ready: boolean;
  historyAvailable: boolean;
  reason: string;
  missing: string[];
  openRouterAvailable: boolean;
  githubConnected?: boolean;
};
type Review = Doc<"reviews">;
type History = NonNullable<ReturnType<typeof useReviewHistory>>[number];
const statusLabel = {
  queued: "Queued",
  running: "Reviewing",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Each worker step reports progress, and a step is bounded at a few minutes,
// so a longer silence means the worker died without recording why.
const STALLED_AFTER_MS = 15 * 60_000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useReviewHistory(enabled: boolean) {
  return useQuery(api.reviews.list, enabled ? {} : "skip");
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "The request failed. Try again.");
  return data;
}

export function ReviewsWorkspace() {
  const chatGPT = useChatGPT();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [setupError, setSetupError] = useState("");
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<Id<"reviews"> | null>(null);
  const [initialFindingId, setInitialFindingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [chosenModel, setModel] = useState<string>(DEFAULT_CODING_MODEL_ID);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const openRouterModels = availability?.openRouterAvailable
    ? REVIEW_MODELS
    : [];
  const chatGPTModels = chatGPT.status?.connected ? chatGPT.status.models : [];
  // The selection can outlive its provider, such as after ChatGPT disconnects.
  const model = [
    ...openRouterModels.map((m) => m.id),
    ...chatGPTModels.map((m) => chatGPTReviewModelId(m.id)),
  ].includes(chosenModel)
    ? chosenModel
    : (openRouterModels[0]?.id ??
      (chatGPTModels[0] && chatGPTReviewModelId(chatGPTModels[0].id)) ??
      "");
  const history = useReviewHistory(availability?.historyAvailable === true);
  const review = useQuery(
    api.reviews.get,
    availability?.historyAvailable && selected ? { id: selected } : "skip",
  );
  const previous = useQuery(
    api.reviews.get,
    availability?.historyAvailable && review?.previousReviewId
      ? { id: review.previousReviewId }
      : "skip",
  );

  async function checkSetup() {
    setChecking(true);
    setSetupError("");
    try {
      setAvailability(await requestJson<Availability>("/api/reviews"));
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    let active = true;
    requestJson<Availability>("/api/reviews")
      .then((value) => {
        if (active) setAvailability(value);
      })
      .catch((e) => {
        if (active) setSetupError((e as Error).message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [chatGPT.status?.connected]);

  async function startReview(
    value: string,
    preferences: string,
    selectedModel: string,
  ) {
    setError("");
    try {
      parsePullRequestUrl(value);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestJson<{ reviewId: Id<"reviews"> }>(
        "/api/reviews",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: value,
            instructions: preferences,
            model: selectedModel,
          }),
        },
      );
      setSelected(result.reviewId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void startReview(url, instructions, model);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between gap-4 border-b px-5 md:px-8">
        <div className="flex items-center gap-5">
          <Link href="/" className="font-semibold tracking-tight">
            Meteroite
          </Link>
          <span className="hidden border-l pl-5 text-sm text-muted-foreground sm:inline">
            Code review
          </span>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" />
            Private workspace
          </span>
          <UserButton />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex items-center justify-between border-b px-5 py-2 lg:hidden">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={historyOpen}
            aria-controls="review-history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            Review history
            <ChevronRight
              className={cn("size-3.5", historyOpen && "rotate-90")}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(null);
              setHistoryOpen(false);
              setError("");
            }}
          >
            New review
          </Button>
        </div>
        <aside
          id="review-history"
          className={cn(
            "border-b bg-sidebar p-5 lg:block lg:border-r lg:border-b-0",
            !historyOpen && "hidden",
          )}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-medium">Review history</h2>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setError("");
              }}
            >
              New review
            </Button>
          </div>
          {checking && (
            <p className="text-sm text-muted-foreground">
              Connecting to your workspace…
            </p>
          )}
          {!checking && !availability?.historyAvailable && (
            <p className="text-sm leading-6 text-muted-foreground">
              Your saved reviews will appear here once the review service is
              ready.
            </p>
          )}
          {availability?.historyAvailable && history === undefined && (
            <p className="text-sm text-muted-foreground">Loading reviews…</p>
          )}
          {history?.length === 0 && (
            <p className="text-sm leading-6 text-muted-foreground">
              Start with a pull request. Every run is saved so you can revisit
              its findings.
            </p>
          )}
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto lg:max-h-[calc(100vh-10rem)]">
            {history?.map((item) => (
              <HistoryItem
                key={item._id}
                item={item}
                active={selected === item._id}
                select={() => {
                  setSelected(item._id);
                  setHistoryOpen(false);
                  setError("");
                }}
              />
            ))}
          </div>
          <p className="mt-8 border-t pt-4 text-xs leading-5 text-muted-foreground">
            Reviews and discussions stay private. Applying a patch requires your
            explicit action.
          </p>
        </aside>
        <main className="min-w-0 px-5 py-8 md:px-10 md:py-12">
          {(setupError ||
            (!checking && availability && !availability.ready)) && (
            <div
              className="mb-8 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4"
              role="status"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Review service isn’t ready yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {setupError || availability?.reason}
                  </p>
                  {!!availability?.missing.length && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Setup requirements
                      </summary>
                      <p className="mt-2 break-words font-mono">
                        {availability.missing.join(", ")}
                      </p>
                    </details>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checking}
                  onClick={() => void checkSetup()}
                >
                  <RotateCcw className="size-3.5" />
                  Recheck
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {selected ? (
            review ? (
              <ReviewDetail
                key={review._id}
                review={review}
                previous={previous ?? undefined}
                initialFindingId={initialFindingId}
                onSelectReview={(id, findingId) => {
                  setInitialFindingId(findingId ?? null);
                  setSelected(id);
                }}
                submitting={submitting}
                onRerun={() =>
                  void startReview(
                    review.url,
                    review.instructions,
                    review.model,
                  )
                }
                onCancel={async () => {
                  try {
                    await requestJson("/api/reviews/cancel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reviewId: review._id }),
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                Loading review…
              </p>
            )
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="mb-9">
                <div className="mb-5 flex size-12 items-center justify-center rounded-xl border bg-sidebar">
                  <SearchCode className="size-6 text-blue-300" />
                </div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  Your second set of eyes
                </p>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                  Understand what a PR might break.
                </h1>
                <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                  Review the changes alongside related code. Get concrete
                  findings with source evidence, then compare them as the PR
                  evolves.
                </p>
              </div>
              <form
                onSubmit={submit}
                className="rounded-xl border bg-sidebar p-5 md:p-7"
              >
                <label htmlFor="pr-url" className="text-sm font-medium">
                  GitHub pull request
                </label>
                <Input
                  id="pr-url"
                  name="url"
                  type="url"
                  required
                  maxLength={500}
                  placeholder="https://github.com/owner/repo/pull/123"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="mt-2 h-11 bg-background"
                  aria-describedby="pr-url-help"
                />
                <p
                  id="pr-url-help"
                  className="mt-2 text-xs text-muted-foreground"
                >
                  Public or private repositories your connected GitHub account
                  can access.
                </p>
                <div className="mt-6">
                  <label htmlFor="review-focus" className="text-sm font-medium">
                    What should your reviewer pay attention to?
                  </label>
                  <Textarea
                    id="review-focus"
                    maxLength={4000}
                    rows={4}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="For example: focus on authorization boundaries and backwards compatibility. Skip style suggestions."
                    className="mt-2 resize-y bg-background"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Optional. Saved with this review and reused when you review
                    it again.
                  </p>
                </div>
                <div className="mt-6 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <label
                      htmlFor="review-model"
                      className="mb-2 block text-xs text-muted-foreground"
                    >
                      Review model
                    </label>
                    <select
                      id="review-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52"
                    >
                      {openRouterModels.length > 0 && (
                        <optgroup label="OpenRouter · API billing">
                          {openRouterModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · OpenRouter
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {chatGPTModels.length > 0 && (
                        <optgroup label="ChatGPT subscription · plan usage">
                          {chatGPTModels.map((m) => (
                            <option
                              key={m.id}
                              value={chatGPTReviewModelId(m.id)}
                            >
                              {m.name} · ChatGPT subscription
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="sm:w-64">
                    <ChatGPTProvider connection={chatGPT} purpose="review" />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={
                      submitting || checking || !availability?.ready || !model
                    }
                  >
                    {submitting ? (
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <GitPullRequest className="size-4" />
                    )}
                    {submitting ? "Starting review…" : "Review pull request"}
                  </Button>
                </div>
                {availability?.ready && !model && (
                  <p className="mt-4 text-sm text-amber-300">
                    No review model is available. Connect ChatGPT or configure
                    OpenRouter.
                  </p>
                )}
                {availability?.ready &&
                  availability.githubConnected === false && (
                    <p className="mt-4 text-sm text-amber-300">
                      Connect GitHub from your account settings before starting
                      a review.
                    </p>
                  )}
              </form>
              <div className="mt-7 grid gap-6 text-sm sm:grid-cols-3">
                {[
                  [
                    "Repository context",
                    "Reads related files and tests to investigate the change.",
                  ],
                  [
                    "Source evidence",
                    "Findings link to changed lines and quoted code.",
                  ],
                  [
                    "Review history",
                    "Revisit each run and compare repeat findings.",
                  ],
                ].map(([title, description]) => (
                  <div key={title}>
                    <h2 className="font-medium">{title}</h2>
                    <p className="mt-2 leading-6 text-muted-foreground">
                      {description}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-8 text-xs leading-5 text-muted-foreground">
                Static review with optional isolated repository checks. Browser
                flows are not executed in this version.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function HistoryItem({
  item,
  active,
  select,
}: {
  item: History;
  active: boolean;
  select: () => void;
}) {
  return (
    <button
      onClick={select}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          {item.repoOwner}/{item.repoName}
        </span>
        <span className="shrink-0">#{item.pullNumber}</span>
      </div>
      <p className="mt-2 truncate text-sm font-medium">
        {item.title ?? "Pull request review"}
      </p>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{statusLabel[item.status]}</span>
        <span>
          {item.findingCount !== undefined
            ? `${item.findingCount} findings`
            : new Date(item._creationTime).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

function ReviewDetail({
  review,
  previous,
  submitting,
  onRerun,
  onCancel,
  initialFindingId,
  onSelectReview,
}: {
  review: Review;
  previous?: Review;
  initialFindingId: string | null;
  onSelectReview: (id: Id<"reviews">, findingId?: string) => void;
  submitting: boolean;
  onRerun: () => void;
  onCancel: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [cancelling, setCancelling] = useState(false);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(() =>
    review.result?.findings.some((finding) => finding.id === initialFindingId)
      ? initialFindingId
      : null,
  );
  const [focus, setFocus] = useState<ReviewNavigationTarget | null>(() => {
    const finding = review.result?.findings.find(
      (entry) => entry.id === initialFindingId,
    );
    return finding ? { kind: "finding", finding } : null;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [freshnessError, setFreshnessError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const files = useQuery(api.reviews.files, { id: review._id });
  const verdicts = useQuery(api.reviewInteractions.verdicts, {
    reviewId: review._id,
  });
  const diffPaths = new Set(
    files?.filter((file) => file.patch).map((file) => file.filename),
  );
  const showDiff = diffPaths.size > 0;
  const navigate = useCallback((target: ReviewNavigationTarget) => {
    setActiveFindingId(target.kind === "finding" ? target.finding.id : null);
    setFocus(target);
  }, []);
  const selectFinding = useCallback(
    (id: string) => {
      const finding = review.result?.findings.find((entry) => entry.id === id);
      if (finding) navigate({ kind: "finding", finding });
    },
    [review.result, navigate],
  );
  const selectHotspot = useCallback(
    (target: Extract<ReviewNavigationTarget, { kind: "hotspot" }>) => {
      setActiveFindingId(null);
      setFocus(target);
    },
    [],
  );
  const running = review.status === "queued" || review.status === "running";
  const now = useNow(30_000);
  const stalled = running && now - review.updatedAt > STALLED_AFTER_MS;
  const result = review.result;
  const findings = useMemo(
    () =>
      sortFindings(
        result?.findings.filter(
          (f) => filter === "all" || f.severity === filter,
        ) ?? [],
      ),
    [result, filter],
  );
  const nitpicks = findings.filter(isNitpick);
  const mainFindings = findings.filter((f) => !isNitpick(f));
  const counts = severityCounts(result?.findings ?? []);
  const renderFinding = (f: (typeof findings)[number]) => (
    <FindingCard
      key={f.id}
      finding={f}
      verdict={verdicts?.[f.id]}
      review={review}
      active={f.id === activeFindingId}
      onDiscuss={() => selectFinding(f.id)}
      onShowInDiff={
        diffPaths.has(f.path)
          ? () => {
              setActiveFindingId(f.id);
              setFocus({ kind: "finding", finding: f });
              // Below xl the diff stacks under the findings.
              document
                .getElementById("review-diff")
                ?.scrollIntoView({ block: "nearest" });
            }
          : undefined
      }
    />
  );
  const linked = new Set(
    result?.findings.map((f) => f.previousFindingId).filter(Boolean),
  );
  const unreported =
    previous?.result?.findings.filter((f) => !linked.has(f.id)) ?? [];
  return (
    <div className={cn("mx-auto", showDiff ? "max-w-none" : "max-w-4xl")}>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <a
            href={review.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 break-all text-sm text-muted-foreground hover:text-foreground"
          >
            {review.repoOwner}/{review.repoName}
            <ChevronRight className="size-3" />#{review.pullNumber}
            <ArrowUpRight className="size-3.5" />
          </a>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
            {review.title ?? "Pull request review"}
          </h1>
          <p className="mt-3 text-xs text-muted-foreground">
            {statusLabel[review.status]} ·{" "}
            {new Date(review._creationTime).toLocaleString()}
            {review.headSha && (
              <>
                {" "}
                ·{" "}
                <span className="font-mono">{review.headSha.slice(0, 7)}</span>
              </>
            )}
          </p>
        </div>
        {running ? (
          <Button
            variant="outline"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await onCancel();
              } finally {
                setCancelling(false);
              }
            }}
          >
            <Square className="size-3.5" />
            {cancelling ? "Cancelling…" : "Cancel review"}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                setFreshnessError("");
                try {
                  await requestJson("/api/reviews/freshness", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reviewId: review._id }),
                  });
                } catch (failure) {
                  setFreshnessError((failure as Error).message);
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {refreshing ? "Checking…" : "Check PR freshness"}
            </Button>
            {review.githubReview ? (
              <Button variant="ghost" asChild>
                <a
                  href={review.githubReview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Check className="size-4" />
                  Posted to GitHub
                  <ArrowUpRight className="size-3.5" />
                </a>
              </Button>
            ) : (
              review.status === "completed" && (
                <Button
                  variant="outline"
                  disabled={publishing}
                  onClick={async () => {
                    setPublishing(true);
                    setPublishError("");
                    try {
                      await requestJson("/api/reviews/publish", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reviewId: review._id }),
                      });
                    } catch (failure) {
                      setPublishError((failure as Error).message);
                    } finally {
                      setPublishing(false);
                    }
                  }}
                >
                  <GitPullRequest className="size-4" />
                  {publishing ? "Posting…" : "Post to GitHub"}
                </Button>
              )
            )}
            <Button variant="outline" disabled={submitting} onClick={onRerun}>
              <RotateCcw
                className={cn(
                  "size-4",
                  submitting && "animate-spin motion-reduce:animate-none",
                )}
              />
              {submitting ? "Starting…" : "Review latest commits"}
            </Button>
          </div>
        )}
      </div>
      {freshnessError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {freshnessError}
        </p>
      )}
      {publishError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {publishError}
        </p>
      )}
      {review.freshness && (
        <p
          role="status"
          className="mb-5 rounded-lg border p-4 text-sm text-muted-foreground"
        >
          {review.freshness.state === "outdated"
            ? "New assessment needed. "
            : review.freshness.state === "current"
              ? "Snapshot current at last check. "
              : "Freshness unavailable. "}
          {review.freshness.reason}
          <span className="mt-2 block text-xs">
            Checked {new Date(review.freshness.observedAt).toLocaleString()}
            {review.freshness.state !== "unavailable" &&
              ` · live head ${review.freshness.headSha.slice(0, 7)}`}
          </span>
        </p>
      )}
      <div
        className={cn(
          showDiff &&
            "xl:grid xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:items-start xl:gap-8",
        )}
      >
        <div className="min-w-0">
          {focus && (
            <section
              id="selected-review-context"
              aria-label="Selected review context"
              className="mb-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-lg bg-sidebar xl:sticky xl:top-6 xl:z-10"
            >
              {focus.kind === "finding" && (
                <>
                  <FindingCard
                    finding={focus.finding}
                    verdict={verdicts?.[focus.finding.id]}
                    review={review}
                    active={true}
                    context={true}
                    onDiscuss={() => selectFinding(focus.finding.id)}
                  />
                  <ReviewFindingPanel
                    key={focus.finding.id}
                    review={review}
                    finding={focus.finding}
                    onReviewLatest={onRerun}
                  />
                </>
              )}
              {focus.kind === "hotspot" && (
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-blue-300">
                    {focus.hotspot.kind === "human_judgment"
                      ? "Human judgment"
                      : "Possible issue"}
                  </p>
                  <h2 className="mt-2 font-medium">{focus.hotspot.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {focus.hotspot.reason}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {focus.reference.path}:{focus.reference.line}
                  </p>
                </div>
              )}
              {focus.kind === "group" && (
                <div className="rounded-lg border p-4">
                  <h2 className="font-medium">{focus.group.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {focus.group.purpose}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {focus.group.hunkIds.length} supporting hunks. Use the group
                    navigation to move between them.
                  </p>
                  <p className="mt-2 break-all font-mono text-xs">
                    {focus.hunk.path} · hunk {focus.hunk.ordinal + 1}
                  </p>
                </div>
              )}
              {focus.kind === "hunk" && (
                <div className="rounded-lg border p-4">
                  <h2 className="break-all font-mono text-sm">
                    {focus.hunk.path}
                  </h2>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Hunk {focus.hunk.ordinal + 1} ·{" "}
                    {focus.hunk.heading || "Changed code"}
                  </p>
                </div>
              )}
              {focus.kind === "file" && (
                <div className="rounded-lg border p-4">
                  <h2 className="break-all font-mono text-sm">{focus.path}</h2>
                  {files
                    ?.filter((file) => file.filename === focus.path)
                    .flatMap((file) =>
                      fileCoverageGaps(file).map((gap) => (
                        <p
                          key={gap.kind}
                          className="mt-2 text-xs leading-5 text-muted-foreground"
                        >
                          {gap.reason}
                        </p>
                      )),
                    )}
                </div>
              )}
            </section>
          )}
          {stalled && (
            <div
              role="alert"
              className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-5"
            >
              <h2 className="font-medium">This review has stopped reporting</h2>
              <p className="mt-2 text-sm leading-6">
                No progress since{" "}
                {new Date(review.updatedAt).toLocaleTimeString()} (last step: “
                {review.progress}”). The background worker likely failed before
                it could save an error. Check the Inngest run for this review,
                then cancel it and start again.
              </p>
            </div>
          )}
          {running && !stalled && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-4 rounded-xl border bg-sidebar p-6"
            >
              <LoaderCircle className="mt-1 size-5 animate-spin text-blue-300 motion-reduce:animate-none" />
              <div>
                <h2 className="font-medium">{review.progress}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  You can leave this page. The review runs in the background and
                  saves its findings here.
                </p>
              </div>
            </div>
          )}
          {review.status === "failed" && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-5"
            >
              <h2 className="font-medium">Review couldn’t finish</h2>
              <p className="mt-2 text-sm">{review.error}</p>
            </div>
          )}
          {review.status === "cancelled" && (
            <p className="rounded-lg border p-5 text-sm text-muted-foreground">
              This review was cancelled. Start another run when you’re ready.
            </p>
          )}
          {result && (
            <>
              {result.outdated && (
                <p
                  role="status"
                  className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm"
                >
                  The PR changed during this review. These findings refer to
                  commit {review.headSha?.slice(0, 7)}. Review the latest
                  commits for current findings.
                </p>
              )}
              <section className="mb-7 rounded-xl border bg-sidebar p-6">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Review summary
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7">
                  {result.summary}
                </p>
                {result.findings.length > 0 && (
                  <p className="mt-4 text-xs font-medium">
                    {counts.high} high · {counts.medium} medium · {counts.low}{" "}
                    low
                  </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  Static analysis · {result.coverage.diffFiles.length}/
                  {result.coverage.changedFiles} file diffs supplied ·{" "}
                  {result.coverage.filesRead.length} source files read
                </p>
                {files?.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    This review predates saved diffs. Review the latest commits
                    to see findings in the diff.
                  </p>
                )}
              </section>
              <ReviewAssessment
                assessment={result.assessment}
                sourceOwner={review.sourceOwner ?? review.repoOwner}
                sourceRepo={review.sourceRepo ?? review.repoName}
              />
              {previous && (
                <ReviewReassessment
                  review={review}
                  previous={previous}
                  files={files ?? []}
                  onOpenReview={onSelectReview}
                  onNavigate={navigate}
                />
              )}
              <ReviewNavigation
                review={review}
                files={files ?? []}
                focus={focus}
                onNavigate={navigate}
              />
              <ReviewHotspots
                review={review}
                files={files ?? []}
                onSelect={selectHotspot}
              />
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  Findings{" "}
                  <span className="ml-2 text-muted-foreground">
                    {result.findings.length}
                  </span>
                </h2>
                <div
                  className="flex gap-1"
                  role="group"
                  aria-label="Filter findings by severity"
                >
                  {["all", "high", "medium", "low"].map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={filter === value ? "secondary" : "ghost"}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                      className="capitalize"
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
              {result.findings.length === 0 ? (
                <div className="flex items-start gap-3 rounded-lg border p-5">
                  <Check className="mt-0.5 size-4 text-blue-300" />
                  <div>
                    <p className="text-sm font-medium">
                      No validated findings reported
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      This review did not establish an actionable issue within
                      its coverage. Check the limitations below; this is not a
                      guarantee that the change is correct.
                    </p>
                  </div>
                </div>
              ) : findings.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">
                  No {filter} severity findings in this run.
                </p>
              ) : (
                <div className="space-y-4">
                  {mainFindings.map(renderFinding)}
                  {nitpicks.length > 0 && (
                    <details className="rounded-lg border p-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Nitpicks and low-confidence notes ({nitpicks.length})
                      </summary>
                      <div className="mt-4 space-y-4">
                        {nitpicks.map(renderFinding)}
                      </div>
                    </details>
                  )}
                </div>
              )}
              {previous?.result && !result.reassessment && (
                <section className="mt-8 border-t pt-6">
                  <h2 className="text-sm font-medium">
                    Compared with the previous review
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {linked.size} linked repeat findings · {unreported.length}{" "}
                    previous findings not reported again
                  </p>
                  {unreported.length > 0 && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer">
                        View findings not reported again
                      </summary>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        Absence from a repeat review does not prove a fix.
                        Coverage and reviewer interpretation can differ.
                      </p>
                      <ul className="mt-3 space-y-2">
                        {unreported.map((f) => (
                          <li key={f.id}>
                            <span className="font-mono text-xs text-muted-foreground">
                              {f.path}:{f.line}
                            </span>
                            <p className="mt-1">{f.title}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}
              <details className="mt-8 rounded-lg border p-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Coverage and limitations{" "}
                  {result.coverage.warnings.length > 0 &&
                    `(${result.coverage.warnings.length})`}
                </summary>
                <div className="mt-4 space-y-4 text-sm leading-6 text-muted-foreground">
                  <p>
                    Tests, builds, and browser flows were not run. Findings are
                    based on the recorded diff and inspected source.
                  </p>
                  {result.coverage.warnings.length > 0 && (
                    <ul className="list-disc space-y-2 pl-5">
                      {result.coverage.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <h3 className="font-medium text-foreground">
                    Source files read
                  </h3>
                  <ul className="break-all font-mono text-xs">
                    {result.coverage.filesRead.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </div>
              </details>
            </>
          )}
        </div>
        {showDiff && (
          <section
            id="review-diff"
            aria-label="Pull request diff"
            className="mt-8 h-[75vh] overflow-hidden rounded-xl border xl:sticky xl:top-6 xl:mt-0 xl:h-[calc(100vh-3rem)]"
          >
            <ReviewDiffPanel
              files={files!}
              findings={findings}
              verdicts={verdicts}
              allFindings={result?.findings ?? []}
              hotspots={result?.hotspots ?? []}
              onSelectHotspot={selectHotspot}
              activeFindingId={activeFindingId}
              focus={focus}
              onSelectFinding={selectFinding}
            />
          </section>
        )}
      </div>
    </div>
  );
}
