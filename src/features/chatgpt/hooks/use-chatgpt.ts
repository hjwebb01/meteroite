"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChatGPTStatus } from "../lib/types";

const ENDPOINT = "/api/providers/chatgpt";
const CHANGED = "meteroite:chatgpt-changed";

async function request<T>(method: string, body?: unknown): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Could not update ChatGPT connection.");
  return data;
}

export function useChatGPT() {
  const [status, setStatus] = useState<ChatGPTStatus>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const initialConnection = useRef<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    const next = await request<ChatGPTStatus>("GET");
    setStatus(next);
    return next;
  }, []);
  useEffect(() => {
    const update = () => {
      void refresh().catch(() => {});
    };
    update();
    window.addEventListener(CHANGED, update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener("focus", update);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 10 * 60_000;
    const poll = async () => {
      try {
        const next = await refresh();
        if (disposed) return;
        if (next.connected && next.connectionId !== initialConnection.current) {
          setPending(false);
          window.dispatchEvent(new Event(CHANGED));
          toast.success(
            "ChatGPT connected. Coding conversations now use your plan.",
          );
          return;
        }
      } catch {
        /* A transient local request failure should not end sign-in. */
      }
      if (disposed) return;
      if (Date.now() > deadline) {
        setPending(false);
        toast.error("ChatGPT sign-in timed out. Please try again.");
      } else timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pending, refresh]);

  const connect = () => {
    initialConnection.current = status?.connectionId;
    setPending(true);
  };
  const update = async (settings: { enabled?: boolean; model?: string }) => {
    setBusy(true);
    try {
      setStatus(await request<ChatGPTStatus>("PATCH", settings));
      window.dispatchEvent(new Event(CHANGED));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update provider.",
      );
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      const { revoked } = await request<{ revoked: boolean }>("DELETE");
      setPending(false);
      await refresh();
      window.dispatchEvent(new Event(CHANGED));
      if (!revoked)
        toast.warning(
          "Disconnected locally. Remote revocation was not confirmed; remove Meteroite access in ChatGPT Settings.",
        );
      else toast.success("ChatGPT disconnected.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not disconnect ChatGPT.",
      );
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    busy,
    pending,
    connect,
    update,
    disconnect,
    refresh,
    stopWaiting: () => setPending(false),
  };
}
