"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
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
  const feedback = useQuery(api.reviews.groupingFeedback, { id: review._id });
  const hunks = useMemo(
    () => savedHunks(files, `legacy:${review._id}`),
    [files, review._id],
  );
  const groups = review.result?.changeGroups ?? [];
  const ungrouped = ungroupedHunks(hunks, groups);
  const matchingFiles = files.filter((file) =>
    `${file.filename}\n${file.previousFilename ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
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
      className="block w-full rounded px-2 py-1.5 text-left text-xs text-blue-300 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="break-all font-mono">{hunk.path}</span>
      <span className="block text-muted-foreground">
        Hunk {hunk.ordinal + 1} · −{hunk.leftStart},{hunk.leftLines} +
        {hunk.rightStart},{hunk.rightLines}
        {hunk.heading && ` · ${hunk.heading}`}
      </span>
    </button>
  );
  return (
    <section
      aria-label="Change navigation"
      className="mb-7 rounded-lg border bg-sidebar p-4"
    >
      <h2 className="font-semibold">Explore changes</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {files.length} files · {hunks.length} saved hunks. Finding filters leave
        this inventory available.
      </p>
      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const members = group.hunkIds.flatMap((id) =>
            hunks.filter((hunk) => hunk.id === id),
          );
          return (
            <details key={group.id} className="rounded border p-3">
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
        <details className="rounded border p-3">
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
      <label
        htmlFor={`file-search-${review._id}`}
        className="mt-5 block text-xs font-medium"
      >
        Find a changed file
      </label>
      <Input
        id={`file-search-${review._id}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search paths…"
        className="mt-2"
      />
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        {matchingFiles.length} matching files
      </p>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {matchingFiles.map((file) => (
          <details key={file.filename} className="border-t py-2">
            <summary className="cursor-pointer break-all font-mono text-xs">
              {file.filename}
              {file.previousFilename && (
                <span className="block text-muted-foreground">
                  Renamed from {file.previousFilename}
                </span>
              )}
            </summary>
            <button
              type="button"
              onClick={() => onNavigate({ kind: "file", path: file.filename })}
              className="mt-2 rounded px-2 py-1 text-xs text-blue-300 underline focus-visible:outline-2 focus-visible:outline-ring"
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
            className="mt-2 min-h-20 w-full rounded border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
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
