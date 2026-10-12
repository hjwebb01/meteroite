"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import ArrowUpRight from "@boxicons/react/ArrowUpRight";
import Check from "@boxicons/react/Check";
import ChevronRight from "@boxicons/react/ChevronRight";
import Clock from "@boxicons/react/Clock";
import GitPullRequest from "@boxicons/react/GitPullRequest";
import LoaderCircle from "@boxicons/react/LoaderLines";
import LockKeyhole from "@boxicons/react/LockKeyhole";
import Plus from "@boxicons/react/Plus";
import RotateCcw from "@boxicons/react/RefreshCcw";
import Square from "@boxicons/react/Square";
import TriangleAlert from "@boxicons/react/AlertTriangle";
import DotsHorizontal from "@boxicons/react/DotsHorizontal";
import { DropdownMenu } from "radix-ui";
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
import {
  NativeSelect,
  NativeSelectOptGroup,
} from "@/components/ui/native-select";
import { Wordmark } from "@/components/wordmark";
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
  const [focusOpen, setFocusOpen] = useState(false);
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

  function startNew() {
    setSelected(null);
    setHistoryOpen(false);
    setError("");
  }

  const parsedUrl = (() => {
    try {
      return parsePullRequestUrl(url);
    } catch {
      return null;
    }
  })();
  const canSubmit =
    !submitting && !checking && !!availability?.ready && !!model;

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="flex flex-col border-b lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
          <Link href="/" className="rounded-sm">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1 lg:hidden">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={historyOpen}
              aria-controls="review-history"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              History
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  historyOpen && "rotate-90",
                )}
              />
            </Button>
            <div className="ml-2 flex">
              <UserButton />
            </div>
          </div>
        </div>
        <nav
          id="review-history"
          aria-label="Reviews"
          className={cn(
            "min-h-0 flex-1 flex-col px-2 pb-3 lg:flex",
            historyOpen ? "flex" : "hidden",
          )}
        >
          <button
            type="button"
            onClick={startNew}
            aria-current={!selected ? "page" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-review-body transition-colors hover:bg-accent hover:text-foreground",
              !selected && "bg-accent text-foreground",
            )}
          >
            <Plus aria-hidden="true" className="size-4 text-review-muted" />
            New review
          </button>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto max-lg:max-h-72 [scrollbar-width:thin]">
            {checking && <RailNote>Connecting…</RailNote>}
            {!checking && !availability?.historyAvailable && (
              <RailNote>
                Saved reviews appear here once the review service is ready.
              </RailNote>
            )}
            {availability?.historyAvailable && history === undefined && (
              <RailNote>Loading reviews…</RailNote>
            )}
            {history?.length === 0 && (
              <RailNote>Every review you run is saved here.</RailNote>
            )}
            {history &&
              groupByAge(groupByPullRequest(history)).map(([label, prs]) => (
                <section key={label} className="mb-4">
                  <h2 className="px-2 pb-1 text-[11px] font-medium text-review-dim">
                    {label}
                  </h2>
                  <ul>
                    {prs.map((runs) => (
                      <li key={runs[0]._id}>
                        <PullRequestItem
                          runs={runs}
                          selected={selected}
                          select={(id) => {
                            setSelected(id);
                            setHistoryOpen(false);
                            setError("");
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </nav>
        <div className="hidden h-14 shrink-0 items-center gap-3 border-t px-4 lg:flex">
          <UserButton />
          <span className="flex items-center gap-1.5 text-xs text-review-muted">
            <LockKeyhole aria-hidden="true" className="size-3.5" />
            Private workspace
          </span>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-6 md:px-8 md:py-8">
        {(setupError || (!checking && availability && !availability.ready)) && (
          <div
            className="mx-auto mb-8 max-w-[640px] rounded-md border border-sev-medium/30 bg-sev-medium/5 p-4"
            role="status"
          >
            <div className="flex items-start gap-3">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-sev-medium"
              />
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
                <RotateCcw aria-hidden="true" className="size-3.5" />
                Recheck
              </Button>
            </div>
          </div>
        )}
        {error && selected && (
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
                void startReview(review.url, review.instructions, review.model)
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
          <div className="mx-auto flex max-w-[640px] flex-col justify-center pt-8 lg:min-h-[calc(100vh-8rem)] lg:pt-0 lg:pb-[12vh]">
            <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.02em] text-balance">
              Review a pull request
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-review-muted text-pretty">
              Findings tied to the changed lines, checked against the code
              around them.
            </p>
            <form
              onSubmit={submit}
              className="mt-6 rounded-md border bg-review-chrome transition-colors focus-within:border-review-border-strong"
            >
              <label htmlFor="pr-url" className="sr-only">
                GitHub pull request URL
              </label>
              <div className="flex items-center gap-3 px-4">
                <GitPullRequest
                  aria-hidden="true"
                  className="size-4 shrink-0 text-review-muted"
                />
                <input
                  id="pr-url"
                  name="url"
                  type="url"
                  required
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={500}
                  placeholder="https://github.com/owner/repo/pull/123"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "review-error" : undefined}
                  className="h-12 min-w-0 flex-1 bg-transparent font-mono text-[13px] placeholder:text-review-muted"
                />
                {parsedUrl && (
                  <Check
                    role="img"
                    aria-label="Valid pull request URL"
                    className="size-4 shrink-0 text-sev-resolved"
                  />
                )}
              </div>
              {(focusOpen || instructions) && (
                <>
                  <label htmlFor="review-focus" className="sr-only">
                    Reviewer focus (optional)
                  </label>
                  {/* Mounted only on request, so autofocus follows "Add focus". */}
                  <textarea
                    id="review-focus"
                    autoFocus
                    maxLength={4000}
                    rows={3}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="What should the reviewer focus on? Saved with this review."
                    className="block min-h-[84px] w-full resize-none border-t bg-transparent px-4 py-3 text-sm leading-6 [field-sizing:content] placeholder:text-review-muted max-h-60"
                  />
                </>
              )}
              <div className="flex flex-wrap items-center gap-1 border-t px-2 py-2">
                <label htmlFor="review-model" className="sr-only">
                  Review model
                </label>
                <NativeSelect
                  id="review-model"
                  size="sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!model}
                  className="h-8 max-w-[15rem] truncate border-0 bg-transparent pr-7 pl-2 text-xs font-medium text-review-body shadow-none transition-colors hover:bg-accent hover:text-foreground focus-visible:border-review-link focus-visible:ring-review-link/30 focus-visible:ring-2 dark:bg-transparent dark:hover:bg-accent"
                >
                  {!model && <option value="">No model available</option>}
                  {openRouterModels.length > 0 && (
                    <NativeSelectOptGroup label="OpenRouter · API billing">
                      {openRouterModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </NativeSelectOptGroup>
                  )}
                  {chatGPTModels.length > 0 && (
                    <NativeSelectOptGroup label="ChatGPT subscription · plan usage">
                      {chatGPTModels.map((m) => (
                        <option key={m.id} value={chatGPTReviewModelId(m.id)}>
                          {m.name} · ChatGPT
                        </option>
                      ))}
                    </NativeSelectOptGroup>
                  )}
                </NativeSelect>
                <ChatGPTProvider connection={chatGPT} />
                {!(focusOpen || instructions) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-review-body hover:text-foreground"
                    onClick={() => setFocusOpen(true)}
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    Add focus
                  </Button>
                )}
                <Button
                  type="submit"
                  className="ml-auto px-3.5"
                  disabled={!canSubmit}
                >
                  {submitting && (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                    />
                  )}
                  {submitting ? "Starting…" : "Start review"}
                </Button>
              </div>
            </form>
            <div className="mt-3 min-h-5 text-xs leading-5">
              {error && !selected ? (
                <p id="review-error" role="alert" className="text-destructive">
                  {error}
                </p>
              ) : availability?.ready && !model ? (
                <p className="text-sev-medium">
                  No review model is available. Connect ChatGPT or configure
                  OpenRouter.
                </p>
              ) : availability?.ready &&
                availability.githubConnected === false ? (
                <p className="text-sev-medium">
                  Connect GitHub from your account settings before starting a
                  review.
                </p>
              ) : (
                <p className="text-review-muted">
                  Works with any repository your GitHub account can access.
                  Nothing is posted until you publish.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function RailNote({ children }: { children: ReactNode }) {
  return <p className="px-2 text-xs leading-5 text-review-muted">{children}</p>;
}

const DAY_MS = 86_400_000;

// Collapses newest-first history into one newest-first run list per pull request.
function groupByPullRequest(items: History[]) {
  const groups = new Map<string, History[]>();
  for (const item of items) {
    const key = `${item.repoOwner}/${item.repoName}#${item.pullNumber}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

// Buckets pull requests by the calendar age of their latest run, preserving order.
function groupByAge(prs: History[][]) {
  const today = new Date().setHours(0, 0, 0, 0);
  const groups = new Map<string, History[][]>();
  for (const runs of prs) {
    const age = today - new Date(runs[0]._creationTime).setHours(0, 0, 0, 0);
    const label =
      age <= 0
        ? "Today"
        : age <= DAY_MS
          ? "Yesterday"
          : age < 7 * DAY_MS
            ? "Previous 7 days"
            : "Older";
    const group = groups.get(label);
    if (group) group.push(runs);
    else groups.set(label, [runs]);
  }
  return [...groups];
}

function PullRequestItem({
  runs,
  selected,
  select,
}: {
  runs: History[];
  selected: Id<"reviews"> | null;
  select: (id: Id<"reviews">) => void;
}) {
  const [latest] = runs;
  const open = runs.some((run) => run._id === selected);
  return (
    <>
      <button
        type="button"
        onClick={() => select(latest._id)}
        aria-current={selected === latest._id ? "page" : undefined}
        title={`${latest.repoOwner}/${latest.repoName} #${latest.pullNumber}${runs.length > 1 ? ` · ${runs.length} runs` : ""}`}
        className={cn(
          "group flex h-8 w-full items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-accent",
          open && "bg-accent",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-review-body group-hover:text-foreground",
            open && "text-foreground",
          )}
        >
          {latest.title ?? `${latest.repoName} #${latest.pullNumber}`}
        </span>
        <RunMeta run={latest} />
      </button>
      {open && runs.length > 1 && (
        <ul
          aria-label="Runs"
          className="my-1 ml-3.5 border-l border-review-border pl-1.5"
        >
          {runs.map((run) => (
            <li key={run._id}>
              <button
                type="button"
                onClick={() => select(run._id)}
                aria-current={selected === run._id ? "page" : undefined}
                className={cn(
                  "flex h-7 w-full items-center gap-3 rounded-md px-2 text-left text-xs text-review-muted tabular-nums transition-colors hover:bg-accent hover:text-foreground",
                  selected === run._id && "text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {formatRunTime(run._creationTime)}
                </span>
                <RunMeta run={run} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function formatRunTime(time: number) {
  return new Date(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const menuItem =
  "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-review-body outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-foreground [&>svg]:text-review-muted";

function RunMeta({ run }: { run: History }) {
  if (run.status === "queued" || run.status === "running")
    return (
      <span
        role="img"
        aria-label={statusLabel[run.status]}
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-review-link motion-reduce:animate-none"
      />
    );
  if (run.status === "completed" && run.findingCount !== undefined)
    return (
      <span
        aria-label={`${run.findingCount} ${run.findingCount === 1 ? "finding" : "findings"}`}
        className="shrink-0 text-xs text-review-dim tabular-nums"
      >
        {run.findingCount}
      </span>
    );
  return (
    <span
      className={cn(
        "shrink-0 text-xs text-review-dim",
        run.status === "failed" && "text-diff-del",
      )}
    >
      {statusLabel[run.status].toLowerCase()}
    </span>
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
  const diffSection = useRef<HTMLElement>(null);
  const contextSection = useRef<HTMLElement>(null);
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
    (id: string | null) => {
      if (id === null) {
        setActiveFindingId(null);
        setFocus(null);
        return;
      }
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
  const inDiff = (f: (typeof findings)[number]) =>
    showDiff && diffPaths.has(f.path);
  const diffFindings = findings.filter(inDiff);
  const listedFindings = findings.filter((f) => !inDiff(f));
  const nitpicks = listedFindings.filter(isNitpick);
  const mainFindings = listedFindings.filter((f) => !isNitpick(f));
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
              diffSection.current?.scrollIntoView({ block: "nearest" });
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
      <header className="mb-5 flex items-start gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-review-muted tabular-nums">
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-review-body hover:text-foreground"
            >
              {review.repoOwner}/{review.repoName} #{review.pullNumber}
            </a>
            <span aria-hidden="true">·</span>
            <span>{statusLabel[review.status]}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRunTime(review._creationTime)}</span>
            {review.headSha && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{review.headSha.slice(0, 7)}</span>
              </>
            )}
          </p>
          <h1 className="mt-1 font-serif text-[19px] leading-tight tracking-[-0.01em] text-balance">
            {review.title ?? "Pull request review"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(refreshing || submitting) && (
            <span
              role="status"
              className="mr-2 flex items-center gap-1.5 text-xs text-review-muted"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              {refreshing ? "Checking freshness…" : "Starting review…"}
            </span>
          )}
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
              <Square aria-hidden="true" className="size-3.5" />
              {cancelling ? "Cancelling…" : "Cancel review"}
            </Button>
          ) : review.githubReview ? (
            <Button variant="ghost" asChild>
              <a
                href={review.githubReview.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Check aria-hidden="true" className="size-4" />
                Posted to GitHub
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
          ) : (
            review.status === "completed" && (
              <Button
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
                {publishing ? "Publishing…" : "Publish review"}
              </Button>
            )
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <DotsHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {!running && (
                  <>
                    <DropdownMenu.Item
                      className={menuItem}
                      disabled={submitting}
                      onSelect={onRerun}
                    >
                      <RotateCcw aria-hidden="true" className="size-4" />
                      Review latest commits
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={menuItem}
                      disabled={refreshing}
                      onSelect={async () => {
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
                      <Clock aria-hidden="true" className="size-4" />
                      Check PR freshness
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                  </>
                )}
                <DropdownMenu.Item className={menuItem} asChild>
                  <a
                    href={review.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                    Open on GitHub
                  </a>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
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
          className="mb-5 rounded-md border p-4 text-sm text-muted-foreground"
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
      {showDiff && (
        <section
          ref={diffSection}
          aria-label="Pull request diff"
          className="mb-10 h-[calc(100vh-6rem)] min-h-[560px] overflow-hidden rounded-md border border-review-border"
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
            onOpenFinding={(id) => {
              selectFinding(id);
              requestAnimationFrame(() =>
                contextSection.current?.scrollIntoView({ block: "start" }),
              );
            }}
          />
        </section>
      )}
      <div className={cn(showDiff && "max-w-4xl")}>
        <div className="min-w-0">
          {focus && (
            <section
              ref={contextSection}
              aria-label="Selected review context"
              className="mb-6 scroll-mt-5 rounded-md bg-sidebar"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <h2 className="text-sm font-medium">Selected review context</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFocus(null);
                    diffSection.current?.scrollIntoView({ block: "start" });
                  }}
                >
                  {showDiff ? "Back to diff" : "Close context"}
                </Button>
              </div>
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
                <div className="rounded-md border p-4">
                  <p className="text-xs text-review-link">
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
                <div className="rounded-md border p-4">
                  <h2 className="font-medium">{focus.group.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {focus.group.purpose}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {focus.group.hunkIds.length} supporting{" "}
                    {focus.group.hunkIds.length === 1 ? "hunk" : "hunks"}. Use
                    the group navigation to move between them.
                  </p>
                  <p className="mt-2 break-all font-mono text-xs">
                    {focus.hunk.path} · hunk {focus.hunk.ordinal + 1}
                  </p>
                </div>
              )}
              {focus.kind === "hunk" && (
                <div className="rounded-md border p-4">
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
                <div className="rounded-md border p-4">
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
              className="rounded-md border border-sev-medium/30 bg-sev-medium/5 p-5"
            >
              <h2 className="font-medium">This review has stopped reporting</h2>
              <p className="mt-2 text-sm leading-6">
                No progress since{" "}
                {new Date(review.updatedAt).toLocaleTimeString()} (last step: “
                {review.progress}”). The background worker likely failed before
                it could save an error. Cancel this review, then start a new
                one.
              </p>
            </div>
          )}
          {running && !stalled && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-4 rounded-md border bg-review-bg p-4"
            >
              <LoaderCircle
                aria-hidden="true"
                className="mt-1 size-5 animate-spin text-review-link motion-reduce:animate-none"
              />
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
              className="rounded-md border border-destructive/30 bg-destructive/10 p-5"
            >
              <h2 className="font-medium">Review couldn’t finish</h2>
              <p className="mt-2 text-sm">{review.error}</p>
            </div>
          )}
          {review.status === "cancelled" && (
            <p className="rounded-md border p-5 text-sm text-muted-foreground">
              This review was cancelled. Start another run when you’re ready.
            </p>
          )}
          {result && (
            <>
              {result.outdated && (
                <p
                  role="status"
                  className="mb-5 rounded-md border border-sev-medium/30 bg-sev-medium/5 p-4 text-sm"
                >
                  The PR changed during this review. These findings refer to
                  commit {review.headSha?.slice(0, 7)}. Review the latest
                  commits for current findings.
                </p>
              )}
              <section className="mb-7 rounded-md border bg-review-bg p-4">
                <h2 className="text-sm font-medium">Review summary</h2>
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
                  Static analysis · Diffs for {result.coverage.diffFiles.length}{" "}
                  of {result.coverage.changedFiles} changed{" "}
                  {result.coverage.changedFiles === 1 ? "file" : "files"} ·{" "}
                  {result.coverage.filesRead.length} source{" "}
                  {result.coverage.filesRead.length === 1 ? "file" : "files"}{" "}
                  read
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
                <div className="flex items-start gap-3 rounded-md border p-5">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 text-review-link"
                  />
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
                    <details className="rounded-md border p-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Nitpicks and low-confidence notes ({nitpicks.length})
                      </summary>
                      <div className="mt-4 space-y-4">
                        {nitpicks.map(renderFinding)}
                      </div>
                    </details>
                  )}
                  {diffFindings.length > 0 && (
                    <details
                      className="rounded-md border p-4"
                      open={listedFindings.length === 0}
                    >
                      <summary className="cursor-pointer text-sm font-medium">
                        Findings shown in the diff ({diffFindings.length})
                      </summary>
                      <div className="mt-4 space-y-4">
                        {diffFindings.map(renderFinding)}
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
                    {linked.size} linked repeat{" "}
                    {linked.size === 1 ? "finding" : "findings"} ·{" "}
                    {unreported.length} previous{" "}
                    {unreported.length === 1 ? "finding" : "findings"} not
                    reported again
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
              <details className="mt-8 rounded-md border p-5">
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
      </div>
    </div>
  );
}
