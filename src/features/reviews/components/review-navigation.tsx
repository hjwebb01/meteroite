"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import {
  savedHunks,
  ungroupedHunks,
  fileCoverageGaps,
  type ChangeGroup,
  type ChangeHunk,
} from "../../../../convex/lib/review_navigation";
import type { ReviewNavigationTarget } from "../lib/review-diff";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ReviewNavigation({
  review,
  files,
  focus,
  onNavigate,
}: {
  review: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  focus: ReviewNavigationTarget | null;
  onNavigate: (target: ReviewNavigationTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const feedback = useQuery(api.reviews.groupingFeedback, { id: review._id });
  const hunks = useMemo(
    () => savedHunks(files, `legacy:${review._id}`),
    [files, review._id],
  );
  const groups = review.result?.changeGroups ?? [];
  const ungrouped = ungroupedHunks(hunks, groups);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingFiles = files.filter((file) =>
    [
      file.filename,
      file.previousFilename ?? "",
      ...hunks
        .filter((hunk) => hunk.path === file.filename)
        .map((hunk) => hunk.heading),
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const hunkButton = (hunk: ChangeHunk, group?: ChangeGroup) => (
    <button
      key={hunk.id}
      type="button"
      onClick={() =>
        onNavigate(
          group ? { kind: "group", group, hunk } : { kind: "hunk", hunk },
        )
      }
      aria-pressed={
        (focus?.kind === "hunk" || focus?.kind === "group") &&
        focus.hunk.id === hunk.id
      }
      className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-review-link hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <code className="break-all">{hunk.path}</code>
      <span className="block text-muted-foreground">
        Hunk {hunk.ordinal + 1} · −{hunk.leftStart},{hunk.leftLines} +
        {hunk.rightStart},{hunk.rightLines}
        {hunk.heading && (
          <span className="block break-words">{hunk.heading}</span>
        )}
      </span>
    </button>
  );
  return (
    <section
      aria-label="Change navigation"
      className="rounded-md border border-review-border bg-review-bg p-4"
    >
      <h3 className="font-semibold">All saved changes</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {files.length} saved files · {hunks.length} saved hunks. Finding filters
        leave this inventory available.
        {review.result &&
          review.result.coverage.changedFiles > files.length &&
          ` Inventory incomplete: ${review.result.coverage.changedFiles - files.length} changed files were not saved.`}
      </p>
      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const members = group.hunkIds.flatMap((id) =>
            hunks.filter((hunk) => hunk.id === id),
          );
          return (
            <details key={group.id} className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {group.title} · {members.length} hunks
              </summary>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {group.purpose}
              </p>
              <div className="mt-2">
                {members.map((hunk) => hunkButton(hunk, group))}
              </div>
              <GroupingFeedback
                review={review}
                group={group}
                saved={
                  feedback?.some((entry) => entry.groupId === group.id) ?? false
                }
              />
            </details>
          );
        })}
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Ungrouped changes · {ungrouped.length} hunks
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            {groups.length
              ? "These saved hunks are outside the generated groups."
              : "This review has no generated groups. Every saved hunk is listed here."}
          </p>
          <div className="mt-2">
            {ungrouped.map((hunk) => hunkButton(hunk))}
          </div>
        </details>
      </div>
      <label htmlFor={searchId} className="mt-5 block text-xs font-medium">
        Find a changed file or hunk
      </label>
      <Input
        id={searchId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search paths or hunk headings…"
        className="mt-2 text-base sm:text-sm"
      />
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        {matchingFiles.length} matching files
      </p>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {matchingFiles.map((file) => (
          <details key={file.filename} className="border-t py-2">
            <summary className="cursor-pointer break-all text-xs">
              <code>{file.filename}</code>
              {file.previousFilename && (
                <span className="block text-muted-foreground">
                  Renamed from {file.previousFilename}
                </span>
              )}
            </summary>
            <button
              type="button"
              onClick={() => onNavigate({ kind: "file", path: file.filename })}
              className="mt-2 rounded-md px-2 py-1 text-xs text-review-link underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {file.patch ? "Open file diff" : "Show file coverage"}
            </button>
            {fileCoverageGaps(file).map((gap) => (
              <p
                key={gap.kind}
                className="mt-2 text-xs leading-5 text-muted-foreground"
              >
                {gap.kind === "model_context_omitted"
                  ? "Model context omitted"
                  : gap.kind === "display_size_excluded"
                    ? "Display size excluded"
                    : "Text patch unavailable"}
                : {gap.reason}
              </p>
            ))}
            {hunks
              .filter((hunk) => hunk.path === file.filename)
              .map((hunk) => hunkButton(hunk))}
          </details>
        ))}
      </div>
    </section>
  );
}

function GroupingFeedback({
  review,
  group,
  saved,
}: {
  review: Doc<"reviews">;
  group: ChangeGroup;
  saved: boolean;
}) {
  const flag = useMutation(api.reviews.flagGrouping);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      await flag({
        id: review._id,
        groupId: group.id,
        requestId: requestId.current,
        reason,
      });
      setOpen(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(false);
    }
  }
  if (saved)
    return (
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        Grouping feedback saved privately.
      </p>
    );
  return (
    <div className="mt-3 border-t pt-2">
      <Button
        size="xs"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Flag incorrect grouping
      </Button>
      {open && (
        <form onSubmit={submit} className="mt-2">
          <label htmlFor={`group-feedback-${group.id}`} className="text-xs">
            What doesn’t belong together?
          </label>
          <textarea
            id={`group-feedback-${group.id}`}
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              requestId.current = null;
            }}
            className="mt-2 min-h-20 w-full rounded-md border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Private feedback. Groups stay available.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            size="xs"
            disabled={pending || !reason.trim()}
            type="submit"
            className="mt-2"
          >
            {pending ? "Saving…" : "Save feedback"}
          </Button>
        </form>
      )}
    </div>
  );
}
