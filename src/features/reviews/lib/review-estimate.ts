const MEDIAN_MS = 61_000;
const P80_MS = 160_000;

export function estimateText(elapsedMs: number): string {
  if (elapsedMs < MEDIAN_MS)
    return `about ${Math.max(1, Math.ceil((MEDIAN_MS - elapsedMs) / 1000))} s left, typically`;
  if (elapsedMs < P80_MS) return "most reviews finish within 3 min";
  return "taking longer than most reviews";
}
