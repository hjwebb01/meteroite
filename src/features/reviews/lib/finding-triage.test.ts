// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { triageFindings } from "./finding-triage";

afterEach(() => vi.unstubAllGlobals());

const finding = (title: string, severity: "low" | "medium" | "high") => ({
  id: title,
  severity,
  title,
  path: "src/a.ts",
  line: 1,
  explanation: "explanation",
  suggestion: "suggestion",
  evidence: [{ path: "src/a.ts", line: 1, quote: "const a = 1;" }],
});

function stubDecisions(
  answersByTitle: Record<
    string,
    { defect: number; dup?: number; score: number; confidence: number }
  >,
) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const { finding } = JSON.parse(body.input);
    const a = answersByTitle[finding.title];
    return Response.json({
      answers: [
        { type: "predicate", name: "real_defect", probability: a.defect },
        {
          type: "score",
          name: "severity",
          score: a.score,
          confidence: a.confidence,
        },
        ...(a.dup === undefined
          ? []
          : [{ type: "predicate", name: "duplicate", probability: a.dup }]),
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("withholds confident false positives and duplicates, keeps uncertain findings", async () => {
  stubDecisions({
    real: { defect: 0.9, score: 2, confidence: 0.9 },
    nit: { defect: 0.05, dup: 0.1, score: 0, confidence: 0.9 },
    copy: { defect: 0.9, dup: 0.95, score: 2, confidence: 0.9 },
    unsure: { defect: 0.4, dup: 0.5, score: 1.4, confidence: 0.4 },
  });
  const result = await triageFindings(
    [
      finding("real", "high"),
      finding("nit", "low"),
      finding("copy", "high"),
      finding("unsure", "medium"),
    ],
    "key",
  );
  expect(result.findings.map((f) => f.title)).toEqual(["real", "unsure"]);
  expect(result.withheld).toBe(2);
  expect(result.adjusted).toBe(0);
});

test("adjusts severity only when the score is confident", async () => {
  stubDecisions({
    a: { defect: 0.9, score: 0.1, confidence: 0.8 },
    b: { defect: 0.9, dup: 0, score: 2, confidence: 0.5 },
  });
  const result = await triageFindings(
    [finding("a", "high"), finding("b", "low")],
    "key",
  );
  expect(result.findings.map((f) => [f.id, f.severity])).toEqual([
    ["a", "low"],
    ["b", "low"],
  ]);
  expect(result.adjusted).toBe(1);
});

test("asks the duplicate question only against earlier findings", async () => {
  const fetch = stubDecisions({
    a: { defect: 0.9, score: 2, confidence: 0.9 },
    b: { defect: 0.9, dup: 0, score: 2, confidence: 0.9 },
  });
  await triageFindings([finding("a", "high"), finding("b", "high")], "key");
  const bodies = fetch.mock.calls.map(([, init]) =>
    JSON.parse(init.body as string),
  );
  expect(
    bodies[0].questions.map((q: { name: string }) => q.name),
  ).not.toContain("duplicate");
  expect(JSON.parse(bodies[1].input).earlierFindings).toEqual([
    { title: "a", path: "src/a.ts", line: 1 },
  ]);
});

test("skips without a key and keeps findings when the API fails", async () => {
  const fetch = vi.fn(async () => new Response("down", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const findings = [finding("a", "high")];
  expect(await triageFindings(findings, "")).toEqual({
    findings,
    withheld: 0,
    adjusted: 0,
  });
  expect(fetch).not.toHaveBeenCalled();
  const failed = await triageFindings(findings, "key");
  expect(failed.findings).toBe(findings);
  expect(failed.warning).toMatch(/unavailable/);
});
