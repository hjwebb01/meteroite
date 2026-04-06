import type { Doc } from "../../../../convex/_generated/dataModel";

type ProgressViewModelStep = {
  id?: string;
  label: string;
  description?: string;
  status?: "pending" | "active" | "complete" | "error";
  kind?: "phase" | "tool";
  toolName?: string;
};

export type ProgressViewModel = {
  activeStep: ProgressViewModelStep | undefined;
  activeIndex: number;
  totalSteps: number;
  completedCount: number;
  summaryTitle: string;
  summarySubtitle: string;
};

function isFinishedStep(step: ProgressViewModelStep): boolean {
  return step.status === "complete" || step.status === "error";
}

/** For completed turns, treat stale active/pending as finished for counts and summaries. */
function isFinishedForTimeline(
  step: ProgressViewModelStep,
  messageStatus: Doc<"messages">["status"],
): boolean {
  if (isFinishedStep(step)) {
    return true;
  }
  return (
    messageStatus === "completed" &&
    (step.status === "active" || step.status === "pending")
  );
}

export function getProgressViewModel(
  progressSteps: ProgressViewModelStep[],
  status: Doc<"messages">["status"],
): ProgressViewModel {
  const totalSteps = progressSteps.length;
  const activeStepIndex =
    status === "processing"
      ? progressSteps.findIndex((step) => step.status === "active")
      : -1;
  const fallbackIndex = totalSteps > 0 ? totalSteps - 1 : -1;
  const resolvedIndex = activeStepIndex >= 0 ? activeStepIndex : fallbackIndex;
  const activeStep =
    resolvedIndex >= 0 ? progressSteps[resolvedIndex] : undefined;
  const activeIndex = resolvedIndex >= 0 ? resolvedIndex + 1 : 0;
  const completedCount = progressSteps.filter((s) =>
    isFinishedForTimeline(s, status),
  ).length;

  if (status === "processing") {
    return {
      activeStep,
      activeIndex,
      totalSteps,
      completedCount,
      summaryTitle: "Current step",
      summarySubtitle:
        activeStep && totalSteps > 0
          ? `Step ${activeIndex} of ${totalSteps}: ${activeStep.label}`
          : "Waiting for progress updates",
    };
  }

  return {
    activeStep,
    activeIndex,
    totalSteps,
    completedCount,
    summaryTitle: "Execution summary",
    summarySubtitle: `Completed ${completedCount} ${
      completedCount === 1 ? "step" : "steps"
    }`,
  };
}
