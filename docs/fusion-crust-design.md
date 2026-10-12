# Fusion crust design refactor

The review app takes its look from a meteorite. Every surface sits on a warm, burnt-brown ground (the fusion crust) with parchment text, and severity is shown as heat. This document records the follow-up decisions on the first build of that design:

- Code moves onto a darker, less saturated well inside the warm chrome, with a hairline under each file header.
- Dismissing a finding cools its row over about 400ms. Only the reviewer's own actions cool.
- Hedvig Letters Serif extends to collapsed finding titles, which wrap to two lines.
- Incandescent orange is reserved for severity. Buttons no longer use it.

The prototype is at [`docs/fusion-crust-visual.html`](fusion-crust-visual.html). `DESIGN.md` remains the canonical token and component reference and must be brought in line with the decisions below when they are built.

## Terms

- **Fusion crust**: the warm burnt-brown ground and parchment text that every surface sits on. *Avoid:* dark mode, theme.
- **Heat**: severity expressed as color temperature. High is incandescent orange (`--sev-high`, `#ff7a45`), medium is ember amber (`--sev-medium`, `#e9ad4f`), and low is ash grey (`--sev-low`, `#a49784`). *Avoid:* priority color, accent.
- **Scorch**: the marking on a flagged code line, made of a 3px severity bar plus a tint that builds toward the margin. *Avoid:* highlight.
- **Streak**: the leader from a flagged line to its finding card. It fades from full color at the code to 30% at the card, is dashed for judgment, and is dotted when resolved. *Avoid:* connector, line.
- **Cooling**: a one-time fade of a finding row from its severity color to muted when the reviewer dismisses it in this session. *Avoid:* fade-out, resolve animation.
- **Well**: the darker, less saturated ground (`#121110`) behind code inside each file block. It is distinct from the warm chrome around it.

## Why

Hunter asked for "a creative and unique refactor of the design". The first build replaced the cool slate Ledger × Margin palette with the fusion crust palette and the heat signature. It also replaced IBM Plex and Newsreader with Hedvig Letters Serif, Schibsted Grotesk, and Spline Sans Mono, added a meteor-streak wordmark, and added press feedback. This grill settled where the first build's choices were open or in tension with the heat metaphor.

## Locked decisions

### Code sits on its own darker well (Q1 → B)

The diff viewer's background (`--diffs-dark-bg`, currently `var(--review-bg)`) becomes a darker, less saturated well, `#121110`. It is set as a new token (for example `--review-code`). The warm chrome stays around it: the rail, header, file tabs, file header (`#241e18`), and margin column. The addition and deletion tint overrides (`--diffs-bg-addition-override`, `--diffs-bg-deletion-override`) and the scorch tint mixes must be recomputed against the well instead of `--review-bg`.

Rejected options:

- **A. Code on the fusion crust** (one ground everywhere, as first built). It was the most unified, but warm brown muddies syntax colors and the add/delete tints. Hunter chose to buy back neutrality for the code.
- **C. Code on the old cool neutral (`#15171c`)**. This would reintroduce a cold color inside a warm frame and break the identity at its most-used surface.

### Orange is reserved for severity (Q7 → B)

Two buttons currently filled with `--sev-high` become parchment-filled, like every other primary button (`--review-text` fill, `--review-bg` text):

- the apply-fix button in `src/features/reviews/components/review-proposal-panel.tsx` (around line 104, `bg-sev-high text-review-bg hover:bg-sev-high/90`)
- the budgeted send button in `src/features/reviews/components/review-finding-panel.tsx` (around line 321, same classes)

After this change the only uses of `--sev-high` are severity marks: the bar, the scorch, the streak, labels, minimap ticks, and the `--sev-high-bg` card ground. The heat reading only holds if nothing else is hot. The `DESIGN.md` token table currently lists "primary action" as a use of `--sev-high`; remove that use.

Rejected options:

- **A. Keep orange for commit actions.** An orange button inside a high card competes with the finding's own bar. Inside a medium or low card it falsely raises the temperature.
- **C. Peridot fill.** This would blur peridot, which means judgment and links.

Consequence: actions that write to GitHub or spend money look no more consequential than Publish review. Their labels and confirmation copy have to carry that weight.

## Routine choices

- **Q2 → B: Cooling lasts about 400ms** (down from 900ms) and uses `--ease-out`. It stays at 200ms under `prefers-reduced-motion`. Reviewers may dismiss dozens of findings in a session, so the fade must finish before the next action.
- **Q3 → C: Hedvig also sets collapsed finding titles.** It now appears on the wordmark, the composer heading, the PR title, expanded finding titles, collapsed finding titles, and the no-findings note. The severity and line label (for example "JUDGMENT L9") stays in Spline Sans Mono.
- **Q4 → B: A 1px `--review-border` rule sits under each file header**, between the header and the well. The header and the well differ mostly in saturation, so the edge needs a line to stay exact. No shadows.
- **Q5 → B: Collapsed titles are Hedvig 14px and wrap to at most two lines** (line-clamp 2), so the claim is not truncated. Collapsed rows therefore vary in height, and the streak's end point must follow each card's actual position. The leader layout already measures card positions, but check this with two-line titles.
- **Q6 → A: Only the reviewer's own dismiss or accept in this session cools.** Resolutions that arrive from a reassessment after a push, or from elsewhere, land without animation. The reassessment summary carries that news.

## Verified facts

These were established by reading the code during the first build and this grill:

- Hedvig Letters Serif ships one weight (400) and no italic. Never pair it with `font-medium` or italic.
- The `@pierre/diffs` viewer renders in shadow DOM. It is themed through inheritable `--diffs-*` variables set on `:host` in `BASE_CSS` (`review-diff-panel.tsx`). Its line selection derives from `--diffs-modified-base`, so `--diffs-modified-color` must stay a non-blue value, currently `var(--review-text)`.
- Flagged lines are styled through `[data-line]:has(+ [data-line-annotation] slot[name="annotation-<side>-<line>"])`.
- The margin column appears only when the diff panel is at least 1000px wide. Below that, cards render inline under their line. This was checked at 390px.
- Cooling only runs for the finding id held in the `cooling` state of `review-diff-panel.tsx`, which `dismiss()` sets. Rows that are already resolved on load never animate. This already satisfies Q6 → A for dismissals. If accepting a fix also resolves a finding, it needs the same hook.

## Risks

- **Tint retuning:** moving code onto `#121110` changes every `color-mix` against `--review-bg`. If the mixes are not recomputed, add/delete lines and the scorch read weaker than in the first build.
- **Seam:** the well, the file header, and the chrome are three close browns. Check the result on a dim or warm-shifted display.
- **Varying row heights** in the margin column (Q5) can make streaks cross or crowd when two findings sit on nearby lines.
- **Parchment commit buttons** (Q7) remove a visual warning from money- and GitHub-affecting actions.
- The sign-in screen and the cooling animation have not been checked in a browser.

## Deferred

None.

## Open threads

None. Every question was answered on the page without discussion.
