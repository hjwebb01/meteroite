// Second-opinion pass over validated findings using OpenAI's Decisions API.
// The review model stays the source of findings; triage only withholds
// confident false positives and duplicates, and corrects severity when sure.
const DECISIONS_URL = "https://api.openai.com/v1/decisions";
const DECISIONS_MODEL = "gpt-6-luna";

// Findings in between are kept: uncertainty favors the review model.
export const TRIAGE_THRESHOLDS = {
  withholdDefectBelow: 0.2,
  withholdDuplicateAbove: 0.8,
  severityConfidence: 0.7,
};

const SEVERITIES = ["low", "medium", "high"] as const;
type Severity = (typeof SEVERITIES)[number];

type TriageFinding = {
  severity: Severity;
  title: string;
  path: string;
  line: number;
  explanation: string;
  suggestion: string;
  evidence: { path: string; line: number; quote: string }[];
};

type Answer =
  | { type: "predicate"; name: string; probability: number }
  | { type: "score"; name: string; score: number; confidence: number }
  | { type: "refusal"; name: string };

function questions(hasEarlier: boolean) {
  return [
    {
      type: "predicate",
      name: "real_defect",
      instructions:
        "Is this finding a concrete defect introduced by the change (a correctness, security, data-loss, broken-contract, or regression bug) that the quoted evidence supports? Answer false for style preferences, speculation, or claims the evidence does not support.",
    },
    {
      type: "score",
      name: "severity",
      instructions:
        "Rate the severity of the finding if it is real, by its consequence for users and data.",
      levels: [
        {
          label: "low",
          description:
            "Minor or unlikely impact; edge cases with easy workarounds.",
        },
        {
          label: "medium",
          description:
            "Wrong behavior in plausible use, without data loss or security impact.",
        },
        {
          label: "high",
          description: "Security, data loss, crashes, or broken core behavior.",
        },
      ],
    },
    ...(hasEarlier
      ? [
          {
            type: "predicate",
            name: "duplicate",
            instructions:
              "Does the finding describe the same underlying issue as one of the earlierFindings?",
          },
        ]
      : []),
  ];
}

async function decide(
  apiKey: string,
  finding: TriageFinding,
  earlier: TriageFinding[],
  signal: AbortSignal,
) {
  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: DECISIONS_MODEL,
      input: JSON.stringify({
        finding: {
          title: finding.title,
          path: finding.path,
          line: finding.line,
          explanation: finding.explanation,
          suggestion: finding.suggestion,
          evidence: finding.evidence,
        },
        ...(earlier.length
          ? {
              earlierFindings: earlier.map(({ title, path, line }) => ({
                title,
                path,
                line,
              })),
            }
          : {}),
      }),
      questions: questions(earlier.length > 0),
    }),
  });
  if (!response.ok)
    throw new Error(`Decisions API returned ${response.status}`);
  const { answers } = (await response.json()) as { answers: Answer[] };
  return new Map(answers.map((answer) => [answer.name, answer]));
}

export async function triageFindings<T extends TriageFinding>(
  findings: T[],
  apiKey = process.env.OPENAI_API_KEY,
) {
  if (!apiKey || !findings.length)
    return { findings, withheld: 0, adjusted: 0 };
  const signal = AbortSignal.timeout(30_000);
  let decisions;
  try {
    decisions = await Promise.all(
      findings.map((finding, index) =>
        decide(apiKey, finding, findings.slice(0, index), signal),
      ),
    );
  } catch {
    return {
      findings,
      withheld: 0,
      adjusted: 0,
      warning:
        "Finding triage was unavailable, so findings were not second-checked.",
    };
  }
  let withheld = 0;
  let adjusted = 0;
  const kept: T[] = [];
  findings.forEach((finding, index) => {
    const answers = decisions[index];
    const defect = answers.get("real_defect");
    const duplicate = answers.get("duplicate");
    if (
      (defect?.type === "predicate" &&
        defect.probability < TRIAGE_THRESHOLDS.withholdDefectBelow) ||
      (duplicate?.type === "predicate" &&
        duplicate.probability > TRIAGE_THRESHOLDS.withholdDuplicateAbove)
    ) {
      withheld++;
      return;
    }
    const severity = answers.get("severity");
    if (
      severity?.type === "score" &&
      severity.confidence >= TRIAGE_THRESHOLDS.severityConfidence
    ) {
      const level = SEVERITIES[Math.round(severity.score)];
      if (level && level !== finding.severity) {
        adjusted++;
        kept.push({ ...finding, severity: level });
        return;
      }
    }
    kept.push(finding);
  });
  return { findings: kept, withheld, adjusted };
}
