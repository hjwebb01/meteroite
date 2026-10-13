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
import { usePaginatedQuery, useQuery } from "convex/react";
import ArrowUpRight from "@boxicons/react/ArrowUpRight";
import Check from "@boxicons/react/Check";
import ChevronRight from "@boxicons/react/ChevronRight";
import Clock from "@boxicons/react/Clock";
import LoaderCircle from "@boxicons/react/LoaderLines";
import LockKeyhole from "@boxicons/react/LockKeyhole";
import Plus from "@boxicons/react/Plus";
import RotateCcw from "@boxicons/react/RefreshCcw";
import Square from "@boxicons/react/Square";
import TriangleAlert from "@boxicons/react/AlertTriangle";
import DotsHorizontal from "@boxicons/react/DotsHorizontal";
import { Dialog, DropdownMenu } from "radix-ui";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ReviewHistoryRow } from "../../../../convex/reviews";
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

export type Availability = {
  ready: boolean;
  historyAvailable: boolean;
  reason: string;
  missing: string[];
  openRouterAvailable: boolean;
  githubConnected?: boolean;
};
type Review = Doc<"reviews">;
export type History = Omit<ReviewHistoryRow, "readCount" | "sectionCount"> &
  Partial<Pick<ReviewHistoryRow, "readCount" | "sectionCount">>;
const statusLabel = {
  queued: "Queued",
  running: "Reviewing",
  completed: "Analysis complete",
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
  return usePaginatedQuery(api.reviews.history, enabled ? {} : "skip", {
    initialNumItems: 30,
  });
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "The request failed. Try again.");
  return data;
}

export type LandingFixture = {
  availability: Availability;
  history?: History[];
  checking?: boolean;
  setupError?: string;
  url: string;
  instructions: string;
  error?: string;
  models?: { id: string; name: string }[];
};

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

export function ReviewsWorkspace({
  fixture,
}: { fixture?: LandingFixture } = {}) {
  const { user } = useUser();
  return (
    <UserReviewWorkspace
      key={user?.id ?? "pending"}
      ownerId={user?.id}
      fixture={fixture}
    />
  );
}

function UserReviewWorkspace({
  ownerId,
  fixture,
}: {
  ownerId?: string;
  fixture?: LandingFixture;
}) {
  const demo = process.env.NODE_ENV === "development" ? fixture : undefined;
  const chatGPT = useChatGPT();
  const { openUserProfile } = useClerk();
  const formId = useId();
  const draftKey = ownerId ? `meteroite:intake:${ownerId}` : null;
  const [draft] = useState(() => (demo ? {} : readIntakeDraft(draftKey)));
  const [availability, setAvailability] = useState<Availability | null>(
    demo?.availability ?? null,
  );
  const [setupError, setSetupError] = useState(demo?.setupError ?? "");
  const [checking, setChecking] = useState(demo?.checking ?? !demo);
  const [selected, setSelected] = useState<Id<"reviews"> | null>(null);
  const [initialFindingId, setInitialFindingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [url, setUrl] = useState(demo?.url ?? draft.url ?? "");
  const [instructions, setInstructions] = useState(
    demo?.instructions ?? draft.instructions ?? "",
  );
  const [chosenModel, setModel] = useState<string>(
    draft.model ?? DEFAULT_CODING_MODEL_ID,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(demo?.error ?? "");
  const openRouterModels = availability?.openRouterAvailable
    ? REVIEW_MODELS
    : [];
  const chatGPTModels = demo
    ? (demo.models ?? [])
    : chatGPT.status?.connected
      ? chatGPT.status.models
      : [];
  // The selection can outlive its provider, such as after ChatGPT disconnects.
  const model = [
    ...openRouterModels.map((m) => m.id),
    ...chatGPTModels.map((m) => chatGPTReviewModelId(m.id)),
  ].includes(chosenModel)
    ? chosenModel
    : (openRouterModels[0]?.id ??
      (chatGPTModels[0] && chatGPTReviewModelId(chatGPTModels[0].id)) ??
      "");
  const liveHistory = useReviewHistory(
    !demo && availability?.historyAvailable === true,
  );
  const history = demo?.history ?? liveHistory.results;
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
    if (demo || !draftKey) return;
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
    if (demo) return;
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
    if (demo) return;
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
  }, [chatGPT.status?.connected, demo]);

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
    if (demo) {
      setError("Fixture preview: no review is submitted.");
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
    setInitialFindingId(null);
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
  const matchingHistory = history.filter((item) =>
    `${item.title ?? ""} ${item.repoOwner}/${item.repoName} #${item.pullNumber}`
      .toLowerCase()
      .includes(historySearch.toLowerCase()),
  );

  return (
    <div className="review-shell min-h-svh bg-background text-foreground">
      <a
        href={`#${formId}-main`}
        className="sr-only z-50 rounded-md bg-background p-3 text-review-link focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to review content
      </a>
      <header className="review-glass sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-8">
        <Link href="/" onClick={startNew} className="rounded-md">
          <Wordmark />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
            <Dialog.Trigger asChild>
              <Button
                variant="ghost"
                className="min-w-0 max-w-[50vw] shrink gap-2"
              >
                <span className="truncate">
                  {review?.title || "Switch review"}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 rotate-90"
                />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65" />
              <Dialog.Content className="review-glass fixed top-[10dvh] left-1/2 z-50 flex max-h-[80dvh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-md border p-5 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <Dialog.Title className="text-lg font-medium">
                    Saved reviews
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm">
                      Close
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="mt-2 text-xs leading-5 text-review-muted">
                  Private analysis and reading history. Publishing is a separate
                  action.
                </Dialog.Description>
                <label htmlFor={`${formId}-history`} className="mt-5 text-xs">
                  Find a pull request
                </label>
                <input
                  id={`${formId}-history`}
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search repository, title or PR number…"
                  className="mt-2 min-w-0 rounded-md border bg-background px-3 py-2 text-base sm:text-sm"
                />
                <nav
                  aria-label="Saved reviews"
                  className="mt-5 min-h-0 flex-1 overflow-y-auto"
                >
                  {checking && <RailNote>Connecting…</RailNote>}
                  {!checking && !availability?.historyAvailable && (
                    <RailNote>
                      Saved reviews become available when the review service is
                      ready.
                    </RailNote>
                  )}
                  {!demo && liveHistory.status === "LoadingFirstPage" && (
                    <RailNote>Loading reviews…</RailNote>
                  )}
                  {history.length === 0 && !checking && (
                    <RailNote>
                      No saved reviews yet. Start with a pull request.
                    </RailNote>
                  )}
                  {historySearch && matchingHistory.length === 0 && (
                    <RailNote>
                      No matching pull requests in loaded history.
                    </RailNote>
                  )}
                  {groupByAge(groupByPullRequest(matchingHistory)).map(
                    ([label, prs]) => (
                      <section key={label} className="mb-5">
                        <h2 className="px-2 pb-2 text-xs text-review-muted">
                          {label}
                        </h2>
                        <ul className="space-y-2">
                          {prs.map((runs) => (
                            <li key={runs[0]._id}>
                              <PullRequestItem
                                runs={runs}
                                selected={selected}
                                select={(id) => {
                                  if (demo) return;
                                  setInitialFindingId(null);
                                  setSelected(id);
                                  setHistoryOpen(false);
                                  setError("");
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ),
                  )}
                  {!demo &&
                    (liveHistory.status === "CanLoadMore" ||
                      liveHistory.status === "LoadingMore") && (
                      <Button
                        variant="outline"
                        className="mt-2 w-full"
                        disabled={liveHistory.status === "LoadingMore"}
                        onClick={() => liveHistory.loadMore(30)}
                      >
                        {liveHistory.status === "LoadingMore"
                          ? "Loading older reviews…"
                          : "Load older reviews"}
                      </Button>
                    )}
                  {historySearch && (
                    <p className="mt-3 text-xs text-review-muted">
                      Search covers loaded reviews. Load older reviews to search
                      more history.
                    </p>
                  )}
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <Button variant="outline" size="sm" onClick={startNew}>
            <Plus aria-hidden="true" className="size-3.5" />
            <span className="max-sm:sr-only">New review</span>
          </Button>
          <UserButton />
        </div>
      </header>
      <main
        id={`${formId}-main`}
        tabIndex={-1}
        className="min-w-0 px-4 py-8 sm:px-8"
      >
        {(setupError || (!checking && availability && !availability.ready)) && (
          <div
            className="mx-auto mb-8 max-w-[640px] rounded-md border border-sev-medium/30 bg-sev-medium/5 p-4"
            role="status"
          >
            <div className="flex flex-wrap items-start gap-3">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-sev-medium"
              />
              <div className="min-w-0 flex-[1_1_12rem]">
                <p className="text-sm font-medium">
                  Review service isn’t ready yet
                </p>
                <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {setupError || availability?.reason}
                </p>
                {!!availability?.missing.length && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Setup requirements
                    </summary>
                    <p className="mt-2 [overflow-wrap:anywhere]">
                      <code>{availability.missing.join(", ")}</code>
                    </p>
                  </details>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={checking}
                className="ml-auto"
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
            className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm [overflow-wrap:anywhere]"
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
          <div className="mx-auto flex max-w-[1376px] flex-col gap-12 pt-10 pb-16 lg:flex-row lg:gap-16 lg:pt-20">
            <div className="flex min-w-0 flex-[7_1_0] flex-col gap-8">
              <h1 className="max-w-[14ch] text-[clamp(36px,4.4vw,64px)] leading-[0.98] font-medium tracking-[-0.05em]">
                Which pull request are you reviewing?
              </h1>
              <form
                onSubmit={submit}
                className="flex max-w-[720px] flex-col gap-5"
              >
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`${formId}-url`}
                    className="text-sm font-medium"
                  >
                    Pull request link
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex min-w-0 flex-1 items-center gap-3 border border-review-border-strong bg-review-reading px-4 transition-colors focus-within:border-review-link motion-reduce:transition-none">
                      <input
                        id={`${formId}-url`}
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
                          persistDraft(
                            e.target.value,
                            instructions,
                            chosenModel,
                          );
                        }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={`${formId}-status`}
                        className="h-[52px] min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-review-dim"
                      />
                      {parsedUrl && (
                        <Check
                          role="img"
                          aria-label="Valid pull request URL"
                          className="size-4 shrink-0 text-sev-resolved"
                        />
                      )}
                    </div>
                    <Button
                      type={needsGitHub ? "button" : "submit"}
                      className="h-[52px] max-w-full shrink-0 px-5 text-base whitespace-normal transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
                      disabled={!needsGitHub && !canSubmit}
                      onClick={
                        needsGitHub
                          ? () => {
                              if (demo)
                                setError(
                                  "Fixture preview: account settings are not opened.",
                                );
                              else openUserProfile();
                            }
                          : undefined
                      }
                    >
                      {submitting && (
                        <LoaderCircle
                          aria-hidden="true"
                          className="size-4 animate-spin motion-reduce:animate-none"
                        />
                      )}
                      {needsGitHub
                        ? "Connect GitHub"
                        : submitting
                          ? "Starting…"
                          : "Start review"}
                    </Button>
                  </div>
                  <div id={`${formId}-status`} className="min-h-6 text-sm">
                    {error && !selected ? (
                      <p
                        id={`${formId}-error`}
                        role="alert"
                        className="text-destructive [overflow-wrap:anywhere]"
                      >
                        {error}
                      </p>
                    ) : availability?.ready && !model ? (
                      <p className="text-sev-medium">
                        No review model is available. Connect ChatGPT or
                        configure OpenRouter.
                      </p>
                    ) : availability?.ready &&
                      availability.githubConnected === false ? (
                      <p className="text-sev-medium">
                        Connect GitHub from your account settings before
                        starting a review.
                      </p>
                    ) : (
                      <p className="text-review-muted">
                        Any repository your GitHub account can read. Saved at
                        the current head commit.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`${formId}-focus`}
                    className="text-sm font-medium"
                  >
                    What should the review pay attention to?{" "}
                    <span className="font-normal text-review-muted">
                      Optional
                    </span>
                  </label>
                  <textarea
                    id={`${formId}-focus`}
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
                    placeholder="Saved with this review."
                    className="block max-h-60 min-h-[92px] w-full resize-none border border-review-border-strong bg-review-reading px-4 py-3.5 text-base leading-6 outline-none transition-colors [field-sizing:content] placeholder:text-review-dim focus:border-review-link motion-reduce:transition-none"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                  <div className="flex min-w-0 max-w-full flex-col gap-2 [&>[data-slot=native-select-wrapper]]:max-w-full">
                    <label
                      htmlFor={`${formId}-model`}
                      className="text-sm font-medium"
                    >
                      Model
                    </label>
                    <NativeSelect
                      id={`${formId}-model`}
                      value={model}
                      title={
                        [
                          ...openRouterModels,
                          ...chatGPTModels.map((m) => ({
                            id: chatGPTReviewModelId(m.id),
                            name: `${m.name} · ChatGPT`,
                          })),
                        ].find((m) => m.id === model)?.name
                      }
                      onChange={(e) => {
                        setModel(e.target.value);
                        persistDraft(url, instructions, e.target.value);
                      }}
                      disabled={!model}
                      className="h-11 w-[min(18rem,100%)] truncate border-review-border-strong bg-review-reading pr-8 pl-3 text-base transition-colors focus-visible:border-review-link focus-visible:ring-0 dark:bg-review-reading"
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
                            <option
                              key={m.id}
                              value={chatGPTReviewModelId(m.id)}
                            >
                              {m.name} · ChatGPT
                            </option>
                          ))}
                        </NativeSelectOptGroup>
                      )}
                    </NativeSelect>
                  </div>
                  <div className="pb-1.5">
                    <ChatGPTProvider connection={chatGPT} />
                  </div>
                </div>
              </form>
              <dl className="flex max-w-[720px] flex-wrap gap-x-8 gap-y-4 pt-2 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">GitHub</dt>
                  <dd className="text-review-muted">
                    {availability?.githubConnected === false
                      ? "Not connected"
                      : availability?.githubConnected
                        ? "Connected"
                        : "Checking…"}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">Models</dt>
                  <dd className="text-review-muted">
                    {openRouterModels.length + chatGPTModels.length === 1
                      ? "1 available"
                      : `${openRouterModels.length + chatGPTModels.length} available`}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium">Privacy</dt>
                  <dd className="text-review-muted">
                    Nothing posts until you publish
                  </dd>
                </div>
              </dl>
            </div>
            {history[0] && (
              <aside
                aria-labelledby={`${formId}-continue`}
                className="review-field flex min-w-0 flex-[5_1_0] flex-col gap-6 self-start p-6 sm:p-8 lg:mt-2"
              >
                <h2
                  id={`${formId}-continue`}
                  className="text-[26px] leading-[1.15] font-medium tracking-[-0.02em]"
                >
                  Continue review
                </h2>
                <div className="flex flex-col gap-1">
                  <p className="text-[22px] leading-[1.25] font-medium tracking-[-0.01em] break-words">
                    {history[0].title ||
                      `${history[0].repoName} #${history[0].pullNumber}`}
                  </p>
                  <p className="text-sm break-all">
                    {history[0].repoOwner}/{history[0].repoName} · #
                    {history[0].pullNumber}
                    {history[0].headSha && (
                      <>
                        {" "}
                        · saved <code>{history[0].headSha.slice(0, 7)}</code>
                      </>
                    )}
                  </p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-base">
                  <dt className="font-medium">Analysis</dt>
                  <dd>{statusLabel[history[0].status]}</dd>
                  {!!history[0].sectionCount && (
                    <>
                      <dt className="font-medium">Your reading</dt>
                      <dd>
                        {history[0].readCount ?? 0} of {history[0].sectionCount}{" "}
                        sections read
                      </dd>
                    </>
                  )}
                  {history[0].freshnessState === "outdated" && (
                    <>
                      <dt className="font-medium">Revision</dt>
                      <dd>Newer source detected · you choose on open</dd>
                    </>
                  )}
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    if (!demo) {
                      setInitialFindingId(null);
                      setSelected(history[0]._id);
                    }
                  }}
                  className="inline-flex h-11 items-center self-start bg-review-bg px-5 text-base font-medium text-review-text transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
                >
                  Open review
                </button>
              </aside>
            )}
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
  const title =
    latest.title?.trim() || `${latest.repoName} #${latest.pullNumber}`;
  const open = runs.some((run) => run._id === selected);
  return (
    <>
      <button
        type="button"
        onClick={() => select(latest._id)}
        aria-current={selected === latest._id ? "page" : undefined}
        title={`${title} · ${latest.repoOwner}/${latest.repoName} #${latest.pullNumber}${runs.length > 1 ? ` (${runs.length} runs)` : ""}`}
        className={cn(
          "group flex min-h-16 w-full items-start gap-3 rounded-md border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent motion-reduce:transition-none",
          open && "bg-accent",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] text-review-body group-hover:text-foreground",
            open && "text-foreground",
          )}
        >
          <span className="block break-words">{title}</span>
          <span className="mt-1 block break-all text-xs leading-5 text-review-muted">
            {latest.repoOwner}/{latest.repoName} #{latest.pullNumber}
          </span>
          {!!latest.sectionCount && (
            <span className="mt-1 block text-xs text-review-muted">
              {latest.readCount ?? 0}/{latest.sectionCount} sections marked read
            </span>
          )}
          {latest.freshnessState === "outdated" && (
            <span className="mt-1 block text-xs text-sev-medium">
              Newer source detected
            </span>
          )}
          {latest.githubReviewUrl && (
            <span className="mt-1 block text-xs text-review-muted">
              GitHub review published
            </span>
          )}
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
                  "flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-xs text-review-muted tabular-nums transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none",
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
  return (
    <span
      className={cn(
        "shrink-0 text-right text-[11px] leading-5 text-review-muted",
        run.status === "failed" && "text-diff-del",
      )}
    >
      <span className="block">{statusLabel[run.status]}</span>
      {run.findingCount !== undefined && (
        <span className="block">
          {run.findingCount} {run.findingCount === 1 ? "finding" : "findings"}
        </span>
      )}
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
