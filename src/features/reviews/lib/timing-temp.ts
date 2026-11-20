// TIMING-TEMP: temporary latency instrumentation. Delete before commit.
import { appendFileSync } from "node:fs";
const LOG =
  "/tmp/claude-1000/-home-hunter-Documents-Code-meteroite/ced2a058-6bfd-4964-8ec7-6403d4aab444/scratchpad/timing.jsonl";
export function mark(label: string, detail: Record<string, unknown> = {}) {
  try {
    appendFileSync(
      LOG,
      JSON.stringify({ t: Date.now(), label, ...detail }) + "\n",
    );
  } catch {}
}
