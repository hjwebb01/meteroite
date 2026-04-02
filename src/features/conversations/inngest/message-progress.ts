import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ProgressStepStatus = "pending" | "active" | "complete" | "error";
export type ProgressStepKind = "phase" | "tool";

/** Matches Convex `messages.progressSteps` items (optional fields support legacy rows). */
export interface ProgressStep {
  id?: string;
  label: string;
  description?: string;
  status?: ProgressStepStatus;
  kind?: ProgressStepKind;
  toolName?: string;
}

const MAX_STEPS = 36;
const MAX_DESC_LEN = 200;

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function computeProgressLabel(steps: ProgressStep[]): string {
  const withStatus = steps.filter(
    (s) => s.status === "active" || s.status === "pending",
  );
  if (withStatus.length > 0) {
    return withStatus[withStatus.length - 1]!.label;
  }
  const last = steps[steps.length - 1];
  return last?.label ?? "Working on your response…";
}

const TOOL_LABELS: Record<string, string> = {
  listFiles: "Listing files",
  readFiles: "Reading files",
  updateFile: "Updating file",
  createFiles: "Creating files",
  createFolder: "Creating folder",
  deleteFiles: "Deleting files",
  renameFile: "Renaming file",
  scrapeUrls: "Scraping URLs",
};

function humanToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function clampSteps(steps: ProgressStep[]): ProgressStep[] {
  if (steps.length <= MAX_STEPS) {
    return steps;
  }
  const head = steps.slice(0, 2);
  const tail = steps.slice(-(MAX_STEPS - head.length));
  return [...head, ...tail];
}

export interface MessageProgressReporter {
  loadedContext: () => Promise<void>;
  beginGeneratingTitle: () => Promise<void>;
  endGeneratingTitle: () => Promise<void>;
  startAgentLoop: (opts: { shouldGenerateTitle: boolean }) => Promise<void>;
  toolStart: (toolName: string, description?: string) => Promise<string>;
  toolEnd: (
    id: string,
    success: boolean,
    errorMessage?: string,
  ) => Promise<void>;
  finalizeResponse: () => Promise<void>;
}

export function createMessageProgressReporter(options: {
  internalKey: string;
  messageId: Id<"messages">;
}): MessageProgressReporter {
  const { internalKey, messageId } = options;

  let steps: ProgressStep[] = [];
  let lastFingerprint = "";
  let toolSeq = 0;
  let planSeq = 0;

  function fingerprint(): string {
    return JSON.stringify({
      steps,
      label: computeProgressLabel(steps),
    });
  }

  async function flush(): Promise<void> {
    const fp = fingerprint();
    if (fp === lastFingerprint) {
      return;
    }
    lastFingerprint = fp;
    steps = clampSteps(steps);
    const progressLabel = computeProgressLabel(steps);
    await convex.mutation(api.system.updateMessageProgress, {
      internalKey,
      messageId,
      progressLabel,
      progressSteps: steps,
    });
  }

  function completeActivePlanningPhases(): void {
    for (const s of steps) {
      if (s.status === "active" && s.kind === "phase") {
        s.status = "complete";
      }
    }
  }

  return {
    async loadedContext() {
      toolSeq = 0;
      planSeq = 0;
      steps = [
        {
          id: "phase-loaded",
          label: "Loaded context",
          status: "complete",
          kind: "phase",
        },
      ];
      await flush();
    },

    async beginGeneratingTitle() {
      steps = [
        {
          id: "phase-loaded",
          label: "Loaded context",
          status: "complete",
          kind: "phase",
        },
        {
          id: "phase-title",
          label: "Generating title",
          status: "active",
          kind: "phase",
        },
      ];
      await flush();
    },

    async endGeneratingTitle() {
      const title = steps.find((s) => s.id === "phase-title");
      if (title) {
        title.status = "complete";
      }
      await flush();
    },

    async startAgentLoop(opts: { shouldGenerateTitle: boolean }) {
      toolSeq = 0;
      planSeq = 1;
      steps = [
        {
          id: "phase-loaded",
          label: "Loaded context",
          status: "complete",
          kind: "phase",
        },
        ...(opts.shouldGenerateTitle
          ? [
              {
                id: "phase-title",
                label: "Generating title",
                status: "complete" as const,
                kind: "phase" as const,
              },
            ]
          : []),
        {
          id: `plan-${planSeq}`,
          label: "Planning next step",
          status: "active" as const,
          kind: "phase" as const,
        },
      ];
      await flush();
    },

    async toolStart(toolName: string, description?: string) {
      completeActivePlanningPhases();
      toolSeq += 1;
      const id = `tool-${toolSeq}`;
      steps.push({
        id,
        label: humanToolLabel(toolName),
        description: description
          ? truncate(description, MAX_DESC_LEN)
          : undefined,
        status: "active",
        kind: "tool",
        toolName,
      });
      await flush();
      return id;
    },

    async toolEnd(id: string, success: boolean, errorMessage?: string) {
      const step = steps.find((s) => s.id === id);
      if (step) {
        step.status = success ? "complete" : "error";
        if (!success && errorMessage) {
          step.description = truncate(errorMessage, MAX_DESC_LEN);
        }
      }
      planSeq += 1;
      steps.push({
        id: `plan-${planSeq}`,
        label: "Planning next step",
        status: "active",
        kind: "phase",
      });
      await flush();
    },

    async finalizeResponse() {
      for (const s of steps) {
        if (s.status === "active") {
          s.status = "complete";
        }
      }
      planSeq += 1;
      steps.push({
        id: `plan-${planSeq}`,
        label: "Finalizing response",
        status: "active",
        kind: "phase",
      });
      await flush();
    },
  };
}
