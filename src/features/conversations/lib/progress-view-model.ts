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

export function getProgressViewModel(
  progressSteps: ProgressViewModelStep[],
  status: Doc<"messages">["status"],
): ProgressViewModel {
  const totalSteps = progressSteps.length;
  const activeStepIndex = progressSteps.findIndex((step) => step.status === "active");
  const fallbackIndex = totalSteps > 0 ? totalSteps - 1 : -1;
  const resolvedIndex = activeStepIndex >= 0 ? activeStepIndex : fallbackIndex;
  const activeStep =
    resolvedIndex >= 0 ? progressSteps[resolvedIndex] : undefined;
  const activeIndex = resolvedIndex >= 0 ? resolvedIndex + 1 : 0;
  const completedCount = progressSteps.filter(isFinishedStep).length;

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
