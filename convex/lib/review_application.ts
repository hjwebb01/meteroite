export type ApplicationBlockReason =
  | "stale"
  | "permission"
  | "scope"
  | "disconnected"
  | "transient"
  | "uncertain"
  | "invalid_proposal";
export class ApplicationBlockedError extends Error {
  constructor(
    public readonly reason: ApplicationBlockReason,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationBlockedError";
  }
}
export const ACTIVE_APPLICATION_STATUSES = [
  "queued",
  "running",
  "writing",
] as const;
const isApplicationActive = (status: string) =>
  (ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(status);
export function applicationAction(application?: {
  status: string;
  blockReason?: ApplicationBlockReason;
}) {
  if (!application) return "apply";
  if (application.status === "applied") return "applied";
  if (isApplicationActive(application.status)) return "wait";
  if (
    application.blockReason === "stale" ||
    application.blockReason === "invalid_proposal"
  )
    return "reassess";
  return "retry";
}
