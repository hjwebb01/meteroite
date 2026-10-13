import { resolveCodingModelId } from "../../../../convex/lib/coding_models";

type InvestigationRequest = {
  requestId: string;
  model: string;
  maxDurationMs: number;
  maxCostMicros: number;
};

type DiscussionSession = {
  cursor: string | undefined;
  model: string;
  seconds: number;
  dollars: number;
  body: string;
  error: string;
  cancellation: string;
  sending: boolean;
  pending: { body: string; requestId: string } | null;
  investigationRequest: InvestigationRequest | null;
};

export function investigationRequestFor(session: DiscussionSession) {
  const parameters = {
    model: session.model,
    maxDurationMs: session.seconds * 1000,
    maxCostMicros: Math.round(session.dollars * 1_000_000),
  };
  const previous = session.investigationRequest;
  return previous &&
    previous.model === parameters.model &&
    previous.maxDurationMs === parameters.maxDurationMs &&
    previous.maxCostMicros === parameters.maxCostMicros
    ? previous
    : { ...parameters, requestId: crypto.randomUUID() };
}

/** Owned by the saved reader, so virtualized annotations can safely unmount. */
export function createDiscussionSessions() {
  const sessions = new Map<string, DiscussionSession>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(findingId: string, reviewModel: string) {
      let session = sessions.get(findingId);
      if (!session) {
        session = {
          cursor: undefined,
          model: resolveCodingModelId(reviewModel),
          seconds: 300,
          dollars: 2,
          body: "",
          error: "",
          cancellation: "",
          sending: false,
          pending: null,
          investigationRequest: null,
        };
        sessions.set(findingId, session);
      }
      return session;
    },
    update(findingId: string, patch: Partial<DiscussionSession>) {
      const session = sessions.get(findingId);
      if (!session) throw new Error("Discussion session not initialized.");
      sessions.set(findingId, { ...session, ...patch });
      for (const listener of listeners) listener();
    },
  };
}

export type DiscussionSessions = ReturnType<typeof createDiscussionSessions>;
