import { ConvexError } from "convex/values";
export type FindingStopReason =
  "time-limit" | "cost-limit" | "cancelled" | "infrastructure";
export class FindingStopped extends Error {
  constructor(
    readonly reason: FindingStopReason,
    message: string,
  ) {
    super(message);
    this.name = "FindingStopped";
  }
}
export function findingStopReason(
  error: unknown,
  signal?: AbortSignal,
): FindingStopReason {
  if (error instanceof FindingStopped) return error.reason;
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data &&
    "reason" in error.data
  ) {
    const reason = error.data.reason;
    if (
      reason === "time-limit" ||
      reason === "cost-limit" ||
      reason === "cancelled"
    )
      return reason;
  }
  if (signal?.aborted) {
    if (signal.reason?.name === "TimeoutError") return "time-limit";
    const reason = findingStopReason(signal.reason);
    return reason === "infrastructure" ? "cancelled" : reason;
  }
  return "infrastructure";
}

export function findingStopMessage(error: unknown) {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data &&
    "message" in error.data &&
    typeof error.data.message === "string"
  )
    return error.data.message;
  return error instanceof Error ? error.message : "Finding work stopped";
}
