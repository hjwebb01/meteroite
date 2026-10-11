# Review screen design

Direction: **Ledger × Margin**. A dense, stacked diff of every changed file, with findings in a margin column beside the code and joined to their line by a leader. Code is never split by finding content. Reviewing and resolving findings is the dominant task; everything else is secondary chrome.

## Tokens

Define as CSS custom properties in `src/app/globals.css`. The review screen is dark in both app themes.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--review-bg` | `#15171c` | Page ground |
| `--review-chrome` | `#1b1e25` | Sticky header, file tabs |
| `--review-file-header` | `#1f232b` | File header bar |
| `--review-hunk` | `#191c22` | Hunk header row |
| `--review-border` | `#2c3039` | All 1px dividers and file outlines |
| `--review-border-strong` | `#3a3f4c` | Secondary buttons, collapsed findings |
| `--review-text` | `#e6e8ee` | Primary text and code |
| `--review-text-body` | `#c4c8d2` | Finding explanations |
| `--review-text-muted` | `#8a90a0` | Metadata, counts, line numbers of interest |
| `--review-text-dim` | `#7d8393` | Directory prefixes, context line numbers; never for sentences |
| `--review-link` | `#8fb4ff` | Links and text buttons |
| `--diff-add-bg` | `rgb(46 160 67 / 12%)` | Added line |
| `--diff-add-fg` | `#7ee0a0` | `+` sign, added counts |
| `--diff-del-bg` | `rgb(248 81 73 / 10%)` | Removed line |
| `--diff-del-fg` | `#ff9b94` | `−` sign, removed counts |
| `--sev-high` | `#ffb380` | High severity: tick, leader, label, primary action |
| `--sev-high-bg` | `#1f1c1a` | Expanded high finding ground |
| `--sev-high-line` | `rgb(255 159 90 / 14%)` | Flagged line tint |
| `--sev-medium` | `#e8c46a` | Medium severity |
| `--sev-judgment` | `#8fb4ff` | Needs human judgment |
| `--sev-resolved` | `#7ee0a0` | Resolved check mark only |
| `--verdict-confirmed` | `#9be6b4` | "reproduced" / "confirmed" label |

Severity is never conveyed by hue alone: every severity color travels with its text label (`HIGH`, `MED`, `JUDGMENT`), and judgment uses a dashed border.

### Typography

| Role | Font | Size / line height | Weight |
| --- | --- | --- | --- |
| PR title | Newsreader | 19px / 1.25 | 500 |
| Expanded finding title | Newsreader | 19px / 1.25 | 500 |
| No-findings note | Newsreader italic | 14px | 400 |
| UI and finding body | IBM Plex Sans | 13.5px / 20px | 400, 500, 600 |
| Metadata, buttons | IBM Plex Sans | 12–12.5px | 400–600 |
| Code, paths, line numbers | IBM Plex Mono | 12.5px / 22px | 400 |
| Severity labels | IBM Plex Mono | 11–12px, uppercase | 600 |
| Fix preview code | IBM Plex Mono | 11.5px / 20px | 400 |

Newsreader is reserved for finding titles and the PR title. It never appears in controls or code.

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

One tab per file in diff order, horizontally scrollable, mono 12.5px. Under each name sits a 6px minimap strip with a 3px tick per finding at its relative position; resolved ticks use `--review-text-dim`. The active tab has a 2px underline in the color of its most severe open finding (judgment uses `--sev-judgment`; a file with only resolved findings or none uses `--review-muted`). A file with no open findings shows `✓`. Ambiguous basenames show their parent directory too.

The active tab is the file at the top of the viewer. It follows scrolling, and a tab picked by click stays active even when the viewer cannot scroll that far.

### File section

The viewer's header is custom (`renderCustomHeader`), so the path is drawn once by us. Expanded: a 1px `--review-border` outline with a `--review-file-header` bar. Collapsed: an outlined row with no fill. Header row: directory prefix in `--review-text-dim`, basename in `--review-text`, `+a −d` right-aligned, then the Show/Hide diff text button. Long paths wrap with `overflow-wrap: anywhere`; never truncate the basename. Body is a wrapping flex row: code column, then margin column with a left border. At narrow widths the margin stacks below the code.

### Diff lines

Unified diff from `@pierre/diffs`. A flagged line gets:

1. a 3px inset left bar in its severity color,
2. a faint tint of the same color, stronger while its finding is the active one,
3. a leader: a 1px dashed rule from the end of the code to its card.

The viewer renders in shadow DOM and has no per-line decoration API, so the bar and tint are generated CSS that targets the line's annotation slot (`annotation-<side>-<line>`). Line-number coloring and a wavy underline are not possible this way and are not used. The selected-line highlight on annotation rows is suppressed so it never competes with the card.

Resolved findings keep a dotted leader in `--review-text-dim` and no other marking.

### Margin findings

Each finding is placed level with its line; when two would overlap, the later one is pushed down and keeps its leader. Order in the margin always matches line order.

- **Collapsed** (default for open findings that aren't active): a single-line button: mono severity and line label, then title. Border `--review-border-strong`; judgment uses a dashed border.
- **Expanded** (the active finding; at most one per file): severity border and `--sev-high-bg` ground. Header row: severity and line label, verdict label, Collapse button. Body in this order: Newsreader title, explanation (clamped to five lines with a Show more link; `backtick` spans render as inline code), proposed fix as a two-line diff, validation result, then actions.
- **Resolved**: one line, struck-through title, `✓` in `--sev-resolved`, Reopen link. No border color.

Actions in an expanded finding, left to right: **Apply fix** (filled in severity color, only when a validated proposal exists), **Comment** (outlined), **Dismiss** (text). Never more than one filled button per finding.

### No-findings file

Collapsed to its header: path, a Newsreader italic 14px `--review-muted` "Read in full — nothing to note.", and a text button to show the diff. The note hides below the `sm` breakpoint. Omitted files (lockfiles, generated) use the same row with the omission reason instead.

### Navigation and focus

- ↑/↓ in the header and `J`/`K` move between open findings across files, expanding the target and scrolling its line to center (instant under `prefers-reduced-motion`).
- Keyboard focus moves to the expanded finding. Every finding control is a real `<button>`; collapsed findings use `aria-expanded`.
- `J`/`K` act only while the panel is on screen (IntersectionObserver), and are ignored in form fields and with modifier keys.
- When findings sit above or below the visible margin, a pill at the top or bottom of the column shows the count and jumps to the nearest one.
- Focus rings: 2px `--review-link` outline, never removed.
