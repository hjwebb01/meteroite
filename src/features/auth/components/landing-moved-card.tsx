"use client";

import { useState } from "react";
import styles from "./landing.module.css";

const states = {
  moved: "Saved at 8c21e4a. The branch is now at f93b10d, 2 commits later.",
  inspect:
    "Viewing your saved revision 8c21e4a. Your read marks are still here.",
  reassess:
    "Next step: request a fresh assessment at f93b10d. Your saved reading at 8c21e4a stays available.",
} as const;

export function LandingMovedCard() {
  const [state, setState] = useState<keyof typeof states>("moved");

  return (
    <div className={styles.moved} data-ui>
      <p className={styles.fragStrong}>This PR has moved on</p>
      <p role="status">{states[state]}</p>
      <p className={styles.fragActions}>
        {state === "moved" ? (
          <>
            <button type="button" onClick={() => setState("inspect")}>
              Inspect 8c21e4a
            </button>
            <button type="button" onClick={() => setState("reassess")}>
              Reassess at f93b10d
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setState("moved")}>
            Back
          </button>
        )}
      </p>
    </div>
  );
}
