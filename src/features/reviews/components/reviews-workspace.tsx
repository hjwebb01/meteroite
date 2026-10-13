"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { UserButton, useClerk, useUser } from "@clerk/nextjs";
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
import { ReviewReader } from "./review-reader";
import { ReviewPublicationPreview } from "./review-publication-preview";

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

type IntakeDraft = { url?: string; instructions?: string; model?: string };

function readIntakeDraft(key: string | null): IntakeDraft {
  if (!key || typeof window === "undefined") return {};
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object") return {};
    const draft = stored as Record<string, unknown>;
    return {
      url: typeof draft.url === "string" ? draft.url.slice(0, 500) : undefined,
      instructions:
        typeof draft.instructions === "string"
          ? draft.instructions.slice(0, 4000)
          : undefined,
      model: typeof draft.model === "string" ? draft.model : undefined,
    };
  } catch {
    return {};
  }
}

export function ReviewsWorkspace() {
  const { user } = useUser();
  return <UserReviewWorkspace key={user?.id ?? "pending"} ownerId={user?.id} />;
}

function UserReviewWorkspace({ ownerId }: { ownerId?: string }) {
  const chatGPT = useChatGPT();
  const { openUserProfile } = useClerk();
  const draftKey = ownerId ? `meteroite:intake:${ownerId}` : null;
  const [draft] = useState(() => readIntakeDraft(draftKey));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [setupError, setSetupError] = useState("");
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<Id<"reviews"> | null>(null);
  const [initialFindingId, setInitialFindingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [url, setUrl] = useState(draft.url ?? "");
  const [instructions, setInstructions] = useState(draft.instructions ?? "");
  const [focusOpen, setFocusOpen] = useState(false);
  const [chosenModel, setModel] = useState<string>(
    draft.model ?? DEFAULT_CODING_MODEL_ID,
  );
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

  function persistDraft(
    nextUrl: string,
    nextInstructions: string,
    nextModel: string,
  ) {
    if (!draftKey) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          url: nextUrl,
          instructions: nextInstructions,
          model: nextModel,
        }),
      );
    } catch {
      // The live form remains usable if storage is unavailable.
    }
  }

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
    const refresh = () => {
      setChecking(true);
      setSetupError("");
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
    };
    // OAuth can return in another tab; refresh access when this workspace regains focus.
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [chatGPT.status?.connected]);

  async function startReview(
    value: string,
    preferences: string,
    selectedModel: string,
  ) {
    setError("");
    if (
      submitting ||
      checking ||
      setupError ||
      !availability?.ready ||
      !selectedModel ||
      availability.githubConnected !== true
    ) {
      setError(
        "Connect GitHub and wait for the review service and a model to be available.",
      );
      return;
    }
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
    !submitting &&
    !checking &&
    !setupError &&
    !!availability?.ready &&
    !!model &&
    availability.githubConnected === true;
  const needsGitHub =
    !checking &&
    !setupError &&
    availability?.ready &&
    !!model &&
    availability.githubConnected === false;

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
                  onChange={(e) => {
                    setUrl(e.target.value);
                    persistDraft(e.target.value, instructions, chosenModel);
                  }}
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
                    onChange={(e) => {
                      setInstructions(e.target.value);
                      persistDraft(url, e.target.value, chosenModel);
                    }}
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
                  onChange={(e) => {
                    setModel(e.target.value);
                    persistDraft(url, instructions, e.target.value);
                  }}
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
                  type={needsGitHub ? "button" : "submit"}
                  className="ml-auto px-3.5"
                  disabled={!needsGitHub && !canSubmit}
                  onClick={needsGitHub ? () => openUserProfile() : undefined}
                >
                  {submitting && (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                    />
                  )}
                  {needsGitHub
                    ? "Connect GitHub"
                    : submitting
                      ? "Starting…"
                      : "Start review"}
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
  const [cancelling, setCancelling] = useState(false);
  const [manualRefreshing, setRefreshing] = useState(false);
  const [checkedSnapshot, setCheckedSnapshot] = useState<string | null>(null);
  const [freshnessError, setFreshnessError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<
    string | null
  >(null);
  const revisionHeadingId = useId();
  const revisionHeading = useRef<HTMLHeadingElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const readingContent = useRef<HTMLDivElement>(null);
  const files = useQuery(api.reviews.files, { id: review._id });
  const verdicts = useQuery(api.reviewInteractions.verdicts, {
    reviewId: review._id,
  });
  const now = useNow(30_000);
  const running = review.status === "queued" || review.status === "running";
  const stalled = running && now - review.updatedAt > STALLED_AFTER_MS;
  const changed =
    review.freshness?.state === "outdated" ||
    (review.result?.outdated === true && review.freshness?.state !== "current");
  const liveHead =
    review.freshness && review.freshness.state !== "unavailable"
      ? review.freshness.headSha
      : null;
  const revisionKey = `${review.headSha ?? "unknown"}:${liveHead ?? "changed-during-analysis"}:${review.freshness?.state !== "unavailable" ? (review.freshness?.baseTipSha ?? "") : ""}`;
  const needsAcknowledgment = changed && acknowledgedRevision !== revisionKey;
  const automaticSnapshotKey = `${review._id}:${review.headSha ?? ""}`;
  const refreshing =
    manualRefreshing ||
    (review.status === "completed" &&
      !!review.headSha &&
      checkedSnapshot !== automaticSnapshotKey);

  useEffect(() => {
    if (review.status !== "completed" || !review.headSha) return;
    let active = true;
    const controller = new AbortController();
    requestJson("/api/reviews/freshness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review._id }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    })
      .catch((failure) => {
        if (active) setFreshnessError((failure as Error).message);
      })
      .finally(() => {
        if (active) setCheckedSnapshot(automaticSnapshotKey);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [review._id, review.headSha, review.status, automaticSnapshotKey]);

  useEffect(() => {
    if (
      needsAcknowledgment &&
      (document.activeElement === document.body ||
        readingContent.current?.contains(document.activeElement))
    )
      revisionHeading.current?.focus();
  }, [needsAcknowledgment, revisionKey]);

  async function checkFreshness() {
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
  }

  const readerProps = {
    review,
    files: files ?? [],
    verdicts,
    previous: previous ?? null,
    initialFindingId,
    onRerun,
    onSelectReview,
  };

  return (
    <div className="mx-auto min-w-0 max-w-[1600px]">
      <header className="mb-6 flex flex-col items-start justify-between gap-4 border-b pb-5 sm:flex-row sm:flex-wrap">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-review-muted">
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-review-link underline-offset-4 hover:underline"
            >
              {review.repoOwner}/{review.repoName} #{review.pullNumber}
            </a>
            <span>
              · {statusLabel[review.status]}, started{" "}
              {formatRunTime(review._creationTime)}
            </span>
          </p>
          <h1 className="mt-3 break-words text-[clamp(20px,2.6vw,32px)] leading-snug tracking-[-0.035em]">
            {review.title || "Pull request review"}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-review-muted">
            <LockKeyhole aria-hidden="true" className="size-3.5" />
            {review.githubReview
              ? "Private work. A review was published separately."
              : "Private work, not posted to GitHub."}
            {review.headSha && (
              <span className="text-review-body">
                Saved revision {review.headSha.slice(0, 7)}
              </span>
            )}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
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
            <Button variant="outline" asChild>
              <a
                href={review.githubReview.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Check aria-hidden="true" className="size-3.5" />
                Published review
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
          ) : review.status === "completed" ? (
            <Button
              ref={previewTrigger}
              variant="outline"
              className="h-auto min-h-8 max-w-full whitespace-normal"
              disabled={refreshing || submitting || needsAcknowledgment}
              onClick={() => setPreviewOpen(true)}
            >
              Preview publication
            </Button>
          ) : null}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More review actions"
              >
                <DotsHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="review-glass z-50 max-w-[calc(100vw-2rem)] min-w-52 rounded-md border p-1 shadow-xl"
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
                      onSelect={() => void checkFreshness()}
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

      <p role="status" className="mb-5 text-xs leading-6 text-review-muted">
        {refreshing ? (
          "Checking the PR revision…"
        ) : review.freshness ? (
          <>
            {review.freshness.state === "current"
              ? "Saved revision was current at last check. "
              : review.freshness.state === "outdated"
                ? "Historical revision · newer source detected. "
                : "PR freshness is unknown. "}
            {review.freshness.reason} Checked{" "}
            {formatRunTime(review.freshness.observedAt)}.
          </>
        ) : review.headSha ? (
          "Saved source is pinned. PR freshness has not been confirmed."
        ) : (
          "The review has not saved a revision yet."
        )}
      </p>
      {freshnessError && (
        <p role="alert" className="mb-5 break-words text-sm text-sev-medium">
          Freshness check failed: {freshnessError} The saved revision is still
          available; this does not confirm it is current.
        </p>
      )}

      {needsAcknowledgment && (
        <section
          className="review-reading-plane mx-auto max-w-3xl border border-sev-medium/40 p-6 sm:p-9"
          aria-labelledby={revisionHeadingId}
        >
          <p className="text-xs text-sev-medium">Revision changed</p>
          <h2
            ref={revisionHeading}
            id={revisionHeadingId}
            tabIndex={-1}
            className="mt-4 text-2xl leading-snug"
          >
            Which revision do you want to inspect?
          </h2>
          <p className="mt-4 text-sm leading-7 text-review-body">
            This analysis belongs to saved commit{" "}
            {review.headSha?.slice(0, 7) ?? "unknown"}
            {liveHead &&
              liveHead !== review.headSha &&
              `; the PR now points to ${liveHead.slice(0, 7)}`}
            . The PR’s source or base context changed. Reading the historical
            result does not update its evidence or authorize a remote action.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setAcknowledgedRevision(revisionKey);
                setPreviewOpen(false);
                requestAnimationFrame(() => readingContent.current?.focus());
              }}
            >
              Inspect saved revision
            </Button>
            <Button disabled={submitting} onClick={onRerun}>
              {submitting ? "Starting…" : "Request reassessment"}
            </Button>
          </div>
          <p className="mt-4 text-xs leading-6 text-review-muted">
            Reassessment starts a new analysis with your saved model and focus.
            It never starts automatically. Historical read marks remain on this
            review.
          </p>
        </section>
      )}
      {!needsAcknowledgment && previewOpen && (
        <ReviewPublicationPreview
          review={review}
          onReviewLatest={onRerun}
          onClose={() => {
            setPreviewOpen(false);
            requestAnimationFrame(() =>
              (previewTrigger.current ?? readingContent.current)?.focus(),
            );
          }}
        />
      )}
      <div
        ref={readingContent}
        tabIndex={-1}
        hidden={needsAcknowledgment || previewOpen}
      >
        {review.status === "completed" && review.result ? (
          files === undefined ||
          (!!review.headSha && checkedSnapshot !== automaticSnapshotKey) ? (
            <p role="status" className="p-6 text-sm text-review-muted">
              {files === undefined
                ? "Loading saved source…"
                : "Checking the saved PR revision…"}
            </p>
          ) : (
            <ReviewReader {...readerProps} />
          )
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            <section
              className="review-reading-plane p-6 sm:p-9"
              aria-label="Analysis activity"
            >
              <p className="text-xs text-review-link">
                Analysis activity · {statusLabel[review.status]}
              </p>
              <h2 className="mt-5 flex items-start gap-3 text-xl leading-snug">
                {running && !stalled && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                )}
                {stalled
                  ? "This review has stopped reporting"
                  : review.status === "failed"
                    ? "Analysis couldn’t finish"
                    : review.status === "cancelled"
                      ? "Analysis cancelled"
                      : review.progress}
              </h2>
              <p
                role={
                  stalled || review.status === "failed" ? "alert" : "status"
                }
                className="mt-4 break-words text-sm leading-7 text-review-muted"
              >
                {stalled
                  ? `No progress since ${formatRunTime(review.updatedAt)}. Last reported step: ${review.progress}. Cancel this run before requesting a new review.`
                  : review.status === "failed"
                    ? review.error
                    : review.status === "cancelled"
                      ? "The saved work is retained. Request another review when you’re ready."
                      : "This is actual background activity, not a completed change brief. You can leave and return through Saved reviews; progress is saved here."}
              </p>
              {!running && (
                <Button
                  className="mt-6"
                  disabled={submitting}
                  onClick={onRerun}
                >
                  {submitting ? "Starting…" : "Review latest commits"}
                </Button>
              )}
            </section>
            {!!files?.length && (
              <details className="rounded-md border">
                <summary className="cursor-pointer px-5 py-4 text-sm">
                  Inspect saved source · {files.length} files
                </summary>
                <div className="border-t p-3">
                  <ReviewReader {...readerProps} sourceOnly />
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
