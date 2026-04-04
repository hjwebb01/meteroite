import { useEffect, useRef, useState } from "react";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";

/** Mirrors Convex `messages.progressSteps` items (client-safe). */
export type MonotonicProgressStep = {
  id?: string;
  label: string;
  description?: string;
  status?: "pending" | "active" | "complete" | "error";
  kind?: "phase" | "tool";
  toolName?: string;
};

const MAX_STEPS = 36;

function incomingKey(step: MonotonicProgressStep, index: number): string {
  return step.id ?? `anon-${index}-${step.label}`;
}

function mergeSteps(
  prevOrder: string[],
  prevById: Map<string, MonotonicProgressStep>,
  incoming: MonotonicProgressStep[] | undefined,
): { order: string[]; byId: Map<string, MonotonicProgressStep> } {
  if (!incoming?.length) {
    return { order: [...prevOrder], byId: new Map(prevById) };
  }

  const order = [...prevOrder];
  const byId = new Map(prevById);

  for (let i = 0; i < incoming.length; i++) {
    const step = incoming[i]!;
    const key = incomingKey(step, i);
    const merged: MonotonicProgressStep = {
      ...byId.get(key),
      ...step,
      id: step.id ?? key,
    };
    byId.set(key, merged);
    if (!order.includes(key)) {
      order.push(key);
    }
  }

  while (order.length > MAX_STEPS) {
    const drop = order.shift();
    if (drop) {
      byId.delete(drop);
    }
  }

  return { order, byId };
}

function toDisplayList(
  order: string[],
  byId: Map<string, MonotonicProgressStep>,
): MonotonicProgressStep[] {
  return order
    .map((id) => byId.get(id))
    .filter((s): s is MonotonicProgressStep => s != null);
}

/**
 * Merge Convex `progressSteps` snapshots by id while a message is processing,
 * then retain the final timeline after completion until the next message reset.
 */
export function useMonotonicProgressSteps(
  messageId: Id<"messages">,
  status: Doc<"messages">["status"],
  rawSteps: Doc<"messages">["progressSteps"],
): MonotonicProgressStep[] {
  const orderRef = useRef<string[]>([]);
  const byIdRef = useRef<Map<string, MonotonicProgressStep>>(new Map());
  const lastMessageIdRef = useRef(messageId);
  const [mergedSteps, setMergedSteps] = useState<MonotonicProgressStep[]>([]);

  useEffect(() => {
    if (lastMessageIdRef.current !== messageId) {
      lastMessageIdRef.current = messageId;
      orderRef.current = [];
      byIdRef.current = new Map();
    }

    if (status === "processing") {
      const merged = mergeSteps(
        orderRef.current,
        byIdRef.current,
        rawSteps ?? undefined,
      );
      orderRef.current = merged.order;
      byIdRef.current = merged.byId;
      setMergedSteps(toDisplayList(merged.order, merged.byId));
      return;
    }

    if (rawSteps?.length) {
      const keys = rawSteps.map((step, index) => incomingKey(step, index));
      const finalSteps = rawSteps.map((step, index) => ({
        ...step,
        id: step.id ?? keys[index],
      }));
      orderRef.current = [...keys];
      byIdRef.current = new Map(
        finalSteps.map((step, index) => [keys[index]!, step]),
      );
      setMergedSteps(finalSteps);
      return;
    }

    orderRef.current = [];
    byIdRef.current = new Map();
    setMergedSteps([]);
  }, [messageId, status, rawSteps]);

  return mergedSteps;
}
