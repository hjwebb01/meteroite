# App design

Direction: **Ledger × Margin, in fusion crust**. A dense, stacked diff of every changed file, with findings in a margin column beside the code and joined to their line by a leader. Code is never split by finding content. Reviewing and resolving findings is the dominant task; everything else is secondary chrome.

The palette is taken from a meteorite: a warm, burnt-brown ground (its fusion crust), parchment text, and severity expressed as heat. High findings burn incandescent orange, medium ones glow ember, low ones are ash, and a dismissed finding cools. Judgment and links use peridot, the olive crystal found in stony-iron meteorites, which is the only cool color in the app.

## Tokens

Define as CSS custom properties in `src/app/globals.css`. The user app is dark in both app themes. Shared app tokens alias the review palette so setup, history, discussion, proposals, and authentication use the same colors.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--review-bg` | `#16120e` | Page ground (fusion crust) |
| `--review-code` | `#121110` | The well: darker, less saturated ground behind code; add/delete tints and scorch mix against it |
| `--review-chrome` | `#1d1813` | Sticky header, file tabs |
| `--review-file-header` | `#241e18` | File header bar |
| `--review-border` | `#342b23` | All 1px dividers and file outlines |
| `--review-border-strong` | `#4c4136` | Secondary buttons, collapsed findings |
| `--review-text` | `#f2e9db` | Primary text and code (parchment); light button fill |
| `--review-text-body` | `#d3c7b5` | Finding explanations |
| `--review-text-muted` | `#a49784` | Metadata, counts, line numbers of interest |
| `--review-text-dim` | `#918573` | Directory prefixes, context line numbers; never for sentences |
| `--review-link` | `#c5d17c` | Links, text buttons, focus rings (peridot) |
| `--diff-add-fg` | `#9fd3a0` | Added lines, `+` counts |
| `--diff-del-fg` | `#f2909f` | Removed lines, `−` counts |
| `--sev-high` | `#ff7a45` | High severity (incandescent), reserved for severity: tick, streak, label, text selection |
| `--sev-high-bg` | `#26170f` | Expanded high finding ground |
| `--sev-medium` | `#e9ad4f` | Medium severity (ember) |
| `--sev-low` | `#a49784` | Low severity (ash) |
| `--sev-judgment` | `#c5d17c` | Needs human judgment (peridot) |
| `--sev-resolved` | `#9fd3a0` | Resolved check mark only |
| `--verdict-confirmed` | `#a8dfb6` | "reproduced" / "confirmed" label |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Press feedback, cooling |

The diff viewer's own variables (`--diffs-dark-bg`, addition, deletion, and modified colors, and the code and header fonts) are set from these tokens, so code sits on the same ground as the app. Its line selection mixes toward parchment, not blue.

Severity is never conveyed by hue alone: every severity color travels with its text label (`HIGH`, `MED`, `JUDGMENT`), and judgment uses a dashed border.

### Typography

| Role | Font | Size / line height | Weight |
| --- | --- | --- | --- |
| Wordmark | Hedvig Letters Serif | 19px | 400 |
| New review heading | Hedvig Letters Serif | 34px / 1.1, −0.02em | 400 |
| PR title, expanded finding title | Hedvig Letters Serif | 19px / 1.25, −0.01em | 400 |
| No-findings note | Hedvig Letters Serif | 14px | 400 |
| UI and finding body | Schibsted Grotesk | 13.5px / 20px | 400, 500, 600 |
| Metadata, buttons | Schibsted Grotesk | 12–12.5px | 400–600 |
| Code, paths, line numbers | Spline Sans Mono | 12.5px / 20px | 400 |
| Severity labels | Spline Sans Mono | 11–12px, uppercase | 600 |
| Fix preview code | Spline Sans Mono | 11.5px / 20px | 400 |

Hedvig Letters Serif has one weight and no italic; never set it in `font-medium` or italic. It is reserved for the wordmark, titles, and the no-findings note, and never appears in controls or code. Schibsted Grotesk runs with tabular figures (`tnum`) and its `ss01` set app-wide.

### Spacing, radius, size

- Base unit 4px. Page gutter 20px; gap between file sections 8px.
- File header padding `6px 12px`; margin column padding `16px`; finding padding `10px 12px`.
- Radius: 6px for files, findings and buttons; 4px for inline code blocks; 2px for minimap ticks.
- Diff gutter: two 40px line-number columns plus a 24px sign column.
- Margin column: fixed 420px, shown when the panel is at least 1000px wide; below that, cards render inline under their line. The column has no ground of its own; it sits on `--review-bg` with a left `--review-border` rule. Code column: `flex: 1; min-width: 0`.
- Button height 32px in the dense surfaces; icon-only buttons 32×32 with an `aria-label`.

## Component rules

### Header

Sticky. Left: PR title, then mono metadata (`#n · head → base · +a −d`). Right: open/resolved counts, previous/next finding buttons, Publish review (light fill, the only filled neutral button on the page).

### File tabs

One tab per file in diff order, horizontally scrollable, mono 12.5px. Under each name sits a 6px minimap strip with a 3px tick per finding at its relative position; open high ticks glow, and resolved ticks use `--review-text-dim`. The active tab has a 2px underline in the color of its most severe open finding (judgment uses `--sev-judgment`; a file with only resolved findings or none uses `--review-muted`). A file with no open findings shows `✓`. Ambiguous basenames show their parent directory too.

The active tab is the file at the top of the viewer. It follows scrolling, and a tab picked by click stays active even when the viewer cannot scroll that far.

### File section

The viewer's header is custom (`renderCustomHeader`), so the path is drawn once by us. Expanded: a 1px `--review-border` outline with a `--review-file-header` bar and a 1px `--review-border` rule between the bar and the well. No shadows. Collapsed: an outlined row with no fill. Header row: directory prefix in `--review-text-dim`, basename in `--review-text`, `+a −d` right-aligned, then the Show/Hide diff text button. Long paths wrap with `overflow-wrap: anywhere`; never truncate the basename. Body is a wrapping flex row: code column, then margin column with a left border. At narrow widths the margin stacks below the code.

### Diff lines

Unified diff from `@pierre/diffs`. A flagged line is scorched:

1. a 3px inset left bar in its severity color,
2. a faint tint of the same color that builds toward the margin edge, stronger while its finding is the active one (the parchment selection stacks under it),
3. a leader streak: a 1.5px rule that leaves the line at full color and fades to 30% at its card. Judgment streaks are dashed.

The viewer renders in shadow DOM and has no per-line decoration API, so the bar and tint are generated CSS that targets the line's annotation slot (`annotation-<side>-<line>`). Line-number coloring and a wavy underline are not possible this way and are not used. The selected-line highlight on annotation rows is suppressed so it never competes with the card.

Resolved findings keep a dotted leader in `--review-text-dim` and no other marking. A finding dismissed in this session cools once: its row's text fades from its severity color to muted over 400ms (200ms under reduced motion). Rows that load already resolved do not animate.

### Margin findings

Each finding is placed level with its line; when two would overlap, the later one is pushed down and keeps its leader. Order in the margin always matches line order.

- **Collapsed** (default for open findings that aren't active): a button: mono severity and line label, then the title in Hedvig 14px, wrapped to at most two lines (rows vary in height; streaks follow each card's measured position). Border `--review-border-strong`; judgment uses a dashed border.
- **Expanded** (the active finding; at most one per file): severity border and `--sev-high-bg` ground. Header row: severity and line label, verdict label, Collapse button. Body in this order: Hedvig title, explanation (clamped to five lines with a Show more link; `backtick` spans render as inline code), proposed fix as a two-line diff, validation result, then actions.
- **Resolved**: one line, struck-through title, `✓` in `--sev-resolved`, Reopen link. No border color.

Actions in an expanded finding, left to right: **Apply fix** (filled in severity color, only when a validated proposal exists), **Comment** (outlined), **Dismiss** (text). Never more than one filled button per finding.

### No-findings file

Collapsed to its header: path, a Hedvig 14px `--review-muted` "Read in full — nothing to note.", and a text button to show the diff. The note hides below the `sm` breakpoint. Omitted files (lockfiles, generated) use the same row with the omission reason instead.

### Navigation and focus

- ↑/↓ in the header and `J`/`K` move between open findings across files, expanding the target and scrolling its line to center (instant under `prefers-reduced-motion`).
- Keyboard focus moves to the expanded finding. Every finding control is a real `<button>`; collapsed findings use `aria-expanded`.
- `J`/`K` act only while the panel is on screen (IntersectionObserver), and are ignored in form fields and with modifier keys.
- When findings sit above or below the visible margin, a pill at the top or bottom of the column shows the count and jumps to the nearest one.
- Focus rings: 2px `--review-link` outline, never removed.

### Motion

- Every button scales to 0.97 on press (150ms, `--ease-out`); color changes share the same transition.
- Nothing animates on keyboard navigation: J/K and ↑/↓ expand findings instantly.
- The only expressive motion is cooling on dismiss.

## Surrounding app flow

- Schibsted Grotesk carries the app UI; Spline Sans Mono is used for source paths and snapshot metadata. Hedvig Letters Serif remains reserved for the wordmark and titles (including discussion context).
- The wordmark is a meteor streak (an orange trail fading in toward a parchment stone) beside "Meteroite" in Hedvig. It appears in the rail, the sign-in screen, and the error screen.
- There is no global header. At desktop widths a sticky, full-height 256px rail carries the wordmark, a New review row, history grouped by age (Today, Yesterday, Previous 7 days, Older), and the account button with the private-workspace note. History shows one single-line row per pull request, represented by its latest run: title plus a muted finding count, a pulsing dot while running, or the status word when failed or cancelled. When the selected pull request has several runs, an indented list of its runs (time and count) opens beneath the row. Below `lg`, the rail collapses to a 48px bar with a History toggle and the account button.
- New review is one centered 640px composer: Hedvig 34px heading, one-line subtitle, then a single bordered surface holding the PR URL (mono, with a check once it parses) and a toolbar with the model, ChatGPT, and Add focus controls on the left and Start review (light fill) on the right. Add focus reveals the focus textarea between the URL and the toolbar; it stays open while it holds text, and Ctrl/⌘+Enter in it submits. One status line sits below: the error, a setup blocker, or a quiet privacy note.
- The review header is one bar: a muted meta line (`owner/repo #n` linking to GitHub, status, run time, short SHA) above the Hedvig title, with Publish review (or Posted to GitHub, or Cancel review while running) and a `···` menu on the right. The menu holds Review latest commits, Check PR freshness, and Open on GitHub; an inline status shows while a freshness check or rerun is in flight.
- Setup, assessments, discussions, and proposals use 6px corners and 1px review borders. Secondary controls are outlined or text; Publish review uses a light fill, and fix actions use the severity fill.
- Model selection and connection controls form a responsive grid. Investigation limits stack into labeled rows on narrow screens. Proposal actions wrap long branch names.
- Selected context includes a Back to diff action. Dismissals remain local to the selected review session.
- Authentication and account surfaces share the dark palette; the sign-in entry explains the private workspace and provides a single sign-in action.
