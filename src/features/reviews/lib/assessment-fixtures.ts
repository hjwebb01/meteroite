import type { AssessmentDraft } from "../../../../convex/lib/review_assessment";

export const assessmentCalibrationFixtures: {
  name: string;
  source: string;
  expectedScore: number;
  assessment: Extract<AssessmentDraft, { state: "complete" }>;
}[] = [
  {
    name: "Documentation correction",
    source: "Read the installation guide before running.",
    expectedScore: 1,
    assessment: {
      state: "complete",
      dimensions: {
        impact: { level: 1, reason: "Only installation wording changes." },
        complexity: { level: 1, reason: "One sentence changes." },
        uncertainty: {
          level: 1,
          reason: "The surrounding guide explains the behavior.",
        },
        coverage: { level: 1, reason: "The changed guide was inspected." },
      },
      evidence: [
        { path: "README.md", line: 1, quote: "Read the installation guide" },
      ],
    },
  },
  {
    name: "Local rendering behavior",
    source: "return labels.map(renderLabel);",
    expectedScore: 2,
    assessment: {
      state: "complete",
      dimensions: {
        impact: { level: 2, reason: "Label presentation affects one screen." },
        complexity: { level: 2, reason: "The mapper and renderer interact." },
        uncertainty: {
          level: 1,
          reason: "The caller and renderer were inspected.",
        },
        coverage: {
          level: 2,
          reason: "Browser rendering needs a human check.",
        },
      },
      evidence: [
        {
          path: "README.md",
          line: 1,
          quote: "return labels.map(renderLabel);",
        },
      ],
    },
  },
  {
    name: "Account lifecycle change",
    source: "await revokeAccountSessions(accountId);",
    expectedScore: 3,
    assessment: {
      state: "complete",
      dimensions: {
        impact: {
          level: 3,
          reason: "Account access depends on the changed lifecycle.",
        },
        complexity: {
          level: 3,
          reason: "Revocation affects several session callers.",
        },
        uncertainty: { level: 2, reason: "One deployment assumption remains." },
        coverage: { level: 2, reason: "Focused runtime confirmation remains." },
      },
      evidence: [
        {
          path: "README.md",
          line: 1,
          quote: "await revokeAccountSessions(accountId);",
        },
      ],
    },
  },
  {
    name: "Authorization without a confirmed defect",
    source: "return authorizeAcrossServices(request);",
    expectedScore: 4,
    assessment: {
      state: "complete",
      dimensions: {
        impact: {
          level: 4,
          reason: "Authorization spans service security boundaries.",
        },
        complexity: {
          level: 4,
          reason: "Several services rely on this contract.",
        },
        uncertainty: {
          level: 3,
          reason: "Deployment interactions need review.",
        },
        coverage: {
          level: 2,
          reason: "Static callers were read but execution is absent.",
        },
      },
      evidence: [
        {
          path: "README.md",
          line: 1,
          quote: "return authorizeAcrossServices(request);",
        },
      ],
    },
  },
  {
    name: "Irreversible data migration",
    source: "await permanentlyDeleteArchivedRecords();",
    expectedScore: 5,
    assessment: {
      state: "complete",
      dimensions: {
        impact: {
          level: 5,
          reason: "Archived records are permanently removed.",
        },
        complexity: {
          level: 3,
          reason: "Deletion crosses storage and migration code.",
        },
        uncertainty: {
          level: 4,
          reason: "Recovery guarantees require confirmation.",
        },
        coverage: {
          level: 3,
          reason: "Production migration behavior was not executed.",
        },
      },
      evidence: [
        {
          path: "README.md",
          line: 1,
          quote: "await permanentlyDeleteArchivedRecords();",
        },
      ],
    },
  },
];
