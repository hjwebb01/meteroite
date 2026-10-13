import { useState } from "react";
import { parsePullRequestUrl } from "@/features/reviews/lib/review";

export const sampleUrl =
  "https://github.com/hjwebb01/meteroite-review-fixture/pull/1";
export const findings = [
  {
    id: "expiry",
    title: "Expired codes still reduce the total",
    severity: "High",
    file: "src/checkout/discounts.ts",
    line: 42,
    claim:
      "The expiry check happens after the discount is applied. An expired code still changes the amount charged.",
    evidence: [
      "const discount = await findCode(input.code);",
      "const total = subtotal - discount.amount;",
      "if (discount.expiresAt < now) return total;",
    ],
    fix: "Reject expired codes before calculating the total.",
    path: "Code lookup → Discount calculation → Payment",
  },
  {
    id: "total",
    title: "A discount can create a negative payment",
    severity: "Medium",
    file: "src/checkout/payment.ts",
    line: 48,
    claim:
      "A $25 fixed discount on a $20 basket produces a −$5 payment amount. There is no lower bound before payment creation.",
    evidence: [
      "const total = subtotal - discount.amount;",
      "return payments.create({ amount: total });",
    ],
    fix: "Clamp the final amount to zero before creating the payment.",
    path: "Discount calculation → Payment",
  },
  {
    id: "case",
    title: "Lowercase codes fail the lookup",
    severity: "Low",
    file: "src/checkout/discounts.ts",
    line: 35,
    claim:
      "WELCOME10 is stored in uppercase. Entering welcome10 fails the exact-match lookup even though it is the same customer-facing code.",
    evidence: [
      "const code = input.code.trim();",
      "return db.codes.findUnique({ where: { code } });",
    ],
    fix: "Normalize the entered code and stored code consistently.",
    path: "Customer input → Code lookup",
  },
] as const;

export interface SampleReview {
  reviewing: boolean;
  setReviewing: (value: boolean) => void;
  url: string;
  setUrl: (value: string) => void;
  error: string;
  active: number;
  select: (index: number) => void;
  resolved: number[];
  notes: Record<number, string[]>;
  draft: string;
  setDraft: (value: string) => void;
  target: string;
  start: (reference?: string) => void;
  toggle: () => void;
  saveNote: () => void;
  finding: (typeof findings)[number];
}
export function useSampleReview(): SampleReview {
  const [reviewing, setReviewing] = useState(false);
  const [url, setUrl] = useState(sampleUrl);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [resolved, setResolved] = useState<number[]>([]);
  const [notes, setNotes] = useState<Record<number, string[]>>({});
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState(
    "hjwebb01 / meteroite-review-fixture · PR #1",
  );
  function start(reference = url) {
    try {
      const parsed = parsePullRequestUrl(reference);
      setUrl(parsed.url);
      setTarget(
        `${parsed.repoOwner} / ${parsed.repoName} · PR #${parsed.pullNumber}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Enter a valid GitHub pull request URL.",
      );
      return;
    }
    setError("");
    setReviewing(true);
    setActive(0);
    setResolved([]);
    setNotes({});
    setDraft("");
  }
  function select(index: number) {
    setActive(index);
    setDraft("");
  }
  function toggle() {
    setResolved((current) =>
      current.includes(active)
        ? current.filter((i) => i !== active)
        : [...current, active],
    );
  }
  function saveNote() {
    if (!draft.trim()) return;
    setNotes((current) => ({
      ...current,
      [active]: [...(current[active] ?? []), draft.trim()],
    }));
    setDraft("");
  }
  return {
    reviewing,
    setReviewing,
    url,
    setUrl,
    error,
    active,
    select,
    resolved,
    notes,
    draft,
    setDraft,
    target,
    start,
    toggle,
    saveNote,
    finding: findings[active],
  };
}
