"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReviewsWorkspace,
  type History,
  type LandingFixture,
} from "./reviews-workspace";

const states = [
  "Demo data",
  "Worst case",
  "Empty",
  "One",
  "50 rows",
  "Error",
  "No model",
  "No GitHub",
  "Loading",
  "Request error",
  "Duplicate titles",
] as const;
type State = (typeof states)[number];
const titles = [
  "Preserve customer-specific notification preferences when migrating enterprise workspaces to the regional authentication service",
  "fix: enterprise-customer-notification-preferences-migration",
  "Jo",
  "Đặng Thị Ngọc Hân — 修复通知设置 👩🏽‍💻",
  "إصلاح إعدادات الإشعارات للمؤسسات",
  "",
  "   ",
  undefined,
  "Render literal <b> tags &amp; **markdown** in imported messages",
];
function fixture(state: State): LandingFixture {
  const demo = state === "Demo data";
  const size =
    state === "Empty"
      ? 0
      : state === "One"
        ? 1
        : state === "50 rows"
          ? 50
          : demo
            ? 3
            : titles.length;
  const now = Date.now();
  const history: History[] = Array.from({ length: size }, (_, i) => ({
    _id: `fixture-${i}` as History["_id"],
    _creationTime: now - [0, 86400000, 12 * 86400000, 365 * 86400000][i % 4],
    repoOwner: "northwind-industries-holdings",
    repoName:
      i % 2 ? "enterprise-customer-notification-preferences" : "platform",
    pullNumber: i + 1,
    title: demo
      ? ["Add discount codes", "Fix login redirect", "Update dependencies"][i]
      : state === "Duplicate titles"
        ? "Update enterprise notification preferences"
        : titles[i % titles.length],
    status: demo
      ? "completed"
      : (["completed", "queued", "running", "failed", "cancelled"] as const)[
          i % 5
        ],
    findingCount: i === 0 ? 1 : 20,
  }));
  const paragraph =
    "Check tenant isolation, Unicode customer names, missing preferences, and backward-compatible notification delivery. Preserve literal <b> tags, &amp; entities, and **markdown** in imported content. ";
  return {
    history: state === "Loading" ? undefined : history,
    checking: state === "Loading",
    models:
      state === "No model" || demo
        ? []
        : [
            {
              id: "gpt-5.1-codex-max",
              name: "GPT-5.1 Codex Max — enterprise reasoning and code review",
            },
          ],
    availability: {
      ready: state !== "Error",
      historyAvailable: true,
      openRouterAvailable: state !== "No model",
      githubConnected: state !== "No GitHub",
      reason:
        "GitHub rejected access to https://github.com/northwind-industries-holdings/enterprise-customer-notification-preferences-migration/pull/1284. Reconnect your account and retry.",
      missing:
        state === "Error" ? ["CONVEX_DEPLOY_KEY", "OPENROUTER_API_KEY"] : [],
    },
    url: demo
      ? "https://github.com/example/platform/pull/1"
      : "https://github.com/northwind-industries-holdings/enterprise-customer-notification-preferences-migration/pull/1284",
    instructions:
      demo || state === "Empty" ? "" : paragraph.repeat(22).slice(0, 4000),
    error:
      state === "Request error"
        ? "Request failed: https://github.com/northwind-industries-holdings/enterprise-customer-notification-preferences-migration/pull/1284/files#diff-31b7c12f9a92b2e3f18d65766a35e6a51f0a3d5b"
        : state === "Error"
          ? "Access denied for northwind-industries-holdings/enterprise-customer-notification-preferences-migration. Ask a repository administrator to grant access."
          : undefined,
  };
}

export function LandingStressTest({ initialData }: { initialData?: string }) {
  const [state, setState] = useState<State>(
    states.includes(initialData as State)
      ? (initialData as State)
      : "Demo data",
  );
  const [largeText, setLargeText] = useState(false);
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = largeText ? "200%" : previous;
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [largeText]);
  const data = useMemo(() => fixture(state), [state]);
  return (
    <>
      <ReviewsWorkspace key={state} fixture={data} />
      <div
        aria-label="Stress test datasets"
        style={{
          position: "fixed",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          width: "max-content",
          maxWidth: "95vw",
          gap: 3,
          padding: 4,
          borderRadius: 8,
          background: "#ddd",
          color: "#222",
          font: "12px system-ui",
        }}
      >
        {states.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={state === value}
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("data", value);
              window.history.replaceState(null, "", url);
              setState(value);
            }}
            style={{
              padding: "5px 8px",
              borderRadius: 5,
              background: state === value ? "white" : "transparent",
            }}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={largeText}
          onClick={() => setLargeText(!largeText)}
          style={{ padding: "5px 8px" }}
        >
          200% text
        </button>
      </div>
    </>
  );
}
