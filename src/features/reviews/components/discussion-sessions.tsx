"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createDiscussionSessions } from "../lib/discussion-session";

const Sessions = createContext<ReturnType<
  typeof createDiscussionSessions
> | null>(null);

export function DiscussionSessions({ children }: { children: ReactNode }) {
  const [sessions] = useState(createDiscussionSessions);
  return <Sessions value={sessions}>{children}</Sessions>;
}

export function useDiscussionSession(findingId: string, reviewModel: string) {
  const sessions = useContext(Sessions);
  if (!sessions) throw new Error("Finding discussion requires a saved reader.");
  const snapshot = () => sessions.get(findingId, reviewModel);
  const session = useSyncExternalStore(sessions.subscribe, snapshot, snapshot);
  return [
    session,
    (patch: Parameters<typeof sessions.update>[1]) =>
      sessions.update(findingId, patch),
  ] as const;
}
