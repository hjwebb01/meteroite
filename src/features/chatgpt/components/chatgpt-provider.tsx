"use client";

import ChevronDownIcon from "@boxicons/react/ChevronDown";
import LoaderIcon from "@boxicons/react/LoaderLines";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { useChatGPT } from "../hooks/use-chatgpt";

export function ChatGPTProvider({
  connection,
}: {
  connection: ReturnType<typeof useChatGPT>;
}) {
  const { status, busy, pending, connect, disconnect, refresh, stopWaiting } =
    connection;
  if (!status?.available) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-review-body hover:text-foreground"
          aria-label="ChatGPT connection settings"
        >
          <span
            aria-hidden="true"
            className={
              status.connected
                ? "size-1.5 rounded-full bg-sev-resolved"
                : "size-1.5 rounded-full border border-review-muted"
            }
          />
          {status.connected ? "ChatGPT" : "Connect ChatGPT"}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 text-review-muted"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-4 [&_button]:h-auto [&_button]:min-h-8 [&_button]:whitespace-normal"
      >
        <div>
          <h2 className="text-sm font-medium">ChatGPT connection</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Connect your ChatGPT account to add its models to the review model
            picker. Each review uses the provider selected there.
          </p>
        </div>
        {status.connected && (
          <p className="break-all text-xs text-muted-foreground">
            Connected as {status.email ?? "your ChatGPT account"}
          </p>
        )}
        {status.error && (
          <p
            role="alert"
            className="text-xs text-destructive [overflow-wrap:anywhere]"
          >
            {status.error}
          </p>
        )}
        {pending && (
          <div className="space-y-2">
            <p role="status" className="flex items-center gap-2 text-xs">
              <LoaderIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              />
              Finish signing in in the new tab.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={stopWaiting}
            >
              Stop waiting
            </Button>
          </div>
        )}
        {/* Keep the form mounted while the browser performs its native submission. */}
        <form
          hidden={pending}
          action="/api/providers/chatgpt"
          method="post"
          target="_blank"
          rel="noopener"
          onSubmit={connect}
        >
          <Button
            className="w-full"
            variant="outline"
            disabled={busy}
            type="submit"
          >
            {busy && (
              <LoaderIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              />
            )}
            {status.connected ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
          </Button>
        </form>
        {status.connected && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={busy || pending}
            onClick={() => void disconnect()}
          >
            Disconnect ChatGPT
          </Button>
        )}
        {status.error && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => {
              void refresh().catch(() => {});
            }}
          >
            Retry loading models
          </Button>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Uses your eligible ChatGPT plan and its usage limits. Your connection
          is saved locally.
        </p>
      </PopoverContent>
    </Popover>
  );
}
