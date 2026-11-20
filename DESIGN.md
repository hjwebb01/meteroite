---
name: Meteroite
description: Private pull request review on a charcoal ground, with one sage action and nothing decorative.
colors:
  ground: "#1c1c1c"
  well: "#181818"
  chrome: "#222222"
  reading: "#262626"
  file-header: "#303030"
  border: "#3a3a3a"
  border-strong: "#5a5a5a"
  text: "#f1f1ef"
  text-body: "#d0d1cb"
  text-muted: "#c4c5bf"
  text-dim: "#a3a49e"
  sage: "#8fa68e"
  context-green: "#2b3229"
  field: "#c8c5ba"
  field-ink: "#1c1c1c"
  diff-add-bg: "#22302a"
  diff-add: "#cfe3cc"
  diff-del-bg: "#3a2725"
  diff-del: "#f3c3bb"
  sev-high: "#f0a58f"
  sev-high-bg: "#2a2624"
  sev-medium: "#e6c98a"
  sev-low: "#b9bab4"
  sev-judgment: "#c9bedf"
  sev-resolved: "#b3cfb0"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 4.4vw, 4rem)"
    fontWeight: 500
    letterSpacing: "-0.04em"
  heading:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.8vw, 2.5rem)"
    fontWeight: 500
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  lead:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  code:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "0.9em"
    fontWeight: 400
rounded:
  none: "0"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    height: "2.75rem"
    padding: "0 1.25rem"
---

# Design System: Meteroite

## Overview

**Creative North Star: "The Margin Ledger"**

Meteroite is a tool for reading a pull request carefully. The ground is neutral charcoal, text is near-white with a faint warm bias, and a single muted sage marks the one action or link that matters on a screen. Structure comes from flat tonal steps and 1px rules; there are no shadows, gradients on text, or decorative color. Severity is the only other hue, and it always travels with a text label.

Corners are square. Type is one sans family plus a mono face for code, paths and revision ids. The generated account of a change is always labeled as generated; source and evidence are shown exactly.

**Key Characteristics:**
- Charcoal ground, tonal layering, 1px rules, square corners.
- One sage accent for the primary action, links, focus and the mark.
- A pale concrete "field" surface for notes the reader must weigh.
- Severity as muted heat, never hue alone.

## Colors

Neutral charcoal with one cool-green accent and a restrained severity set.

### Primary
- **Sage** (#8fa68e): primary button fill, links, focus rings, the active rail entry, the wordmark slab. Used on a small share of any screen.

### Neutral
- **Ground** (#1c1c1c): page background. **Well** (#181818): behind code. **Chrome** (#222222): sticky bars, popovers, sidebar. **Reading** (#262626): quiet panels and rows. **File header** (#303030).
- **Border** (#3a3a3a): every 1px divider. **Border strong** (#5a5a5a): secondary controls, switch track.
- **Text** (#f1f1ef), **Body** (#d0d1cb), **Muted** (#c4c5bf), **Dim** (#a3a49e; metadata and line numbers, never sentences).
- **Context green** (#2b3229): ground for context sections. **Field** (#c8c5ba) with **Field ink** (#1c1c1c): the concrete surface for weighable notes.

### Semantic
- Added lines on #22302a with #cfe3cc text; removed lines on #3a2725 with #f3c3bb text.
- Severity: high #f0a58f (ground #2a2624), medium #e6c98a, low #b9bab4, judgment #c9bedf, resolved #b3cfb0.

### Named Rules
**The One Action Rule.** Sage marks the single action or link that matters; if two things are sage, one is wrong.
**The Label Rule.** Severity and diff state are never carried by color alone.

## Typography

**Display and body:** Hanken Grotesk (400, 500) with system-ui fallback. **Code, paths, revision ids:** Spline Sans Mono. Tabular figures app-wide.

**Character:** plain and exact. Hierarchy comes from size and a single step of weight, not from a second family.

### Hierarchy
- **Display** (500, clamp 2.5–4rem, tracking −0.04em): the landing H1 only.
- **Heading** (500, clamp 1.75–2.5rem, −0.03em): section headings.
- **Body** (400, 1.0625rem, 1.5): prose, measure about 58–60ch.
- **Code** (mono, 0.9em): code, file paths, revisions. Never for decoration.

**Scale:** four literal steps plus the clamps above. Caption 0.8125rem (labels, grounding lines, notes, diff lines). UI 0.9375rem (controls, rail, small text, findings). Body 1.0625rem (prose, purpose titles on the lead). Lead 1.125rem (landing lede). Other sizes are not used.

### Named Rules
**The Plain Voice Rule.** No eyebrows or kickers above headings; the heading carries its own weight.

## Layout

Dense and linear. The landing is a sticky left rail of section links beside a single main column; below 760px the rail becomes a sticky horizontal strip of the same entries. Sections are separated by generous top padding (4–6rem), related content sits tight. The review app uses a diff column with a margin column for findings when width allows, and stacks below that. Base unit 4px.

## Elevation & Depth

Flat. Depth is tonal: ground, chrome, reading, file header, in that order of lift. There are no shadows. A single photographic plate (a credited photograph of an etched meteorite face, 4:3) opens the publish section as the product's signature moment.

## Shapes

Square corners everywhere (radius 0). Borders are 1px; the lead item in a list may add a 1px inset sage outline. Switches are the one pill shape.

## Components

### Buttons
- **Primary:** sage fill, ground text, 44px tall, 20px inline padding, weight 500. Hover lightens the fill by 15%. Press feedback uses `cubic-bezier(0.23, 1, 0.32, 1)` at 150ms.
- **Secondary:** outlined with border-strong, or text only.

### Sample review (landing)
A bordered stage holding a generated brief of purposes. The lead purpose is larger, outlined in sage and labeled "Start here". Each purpose row has a grounding line (file, location, finding count) and a "Mark read" toggle that reads "Marked read" once pressed; marks are the reader's and never approve a change. Opening a purpose folds the brief into a spine beside its exact diff.

### Publication preview
Include switches beside the exact text GitHub would receive. Inline comments render on the high-severity ground.

### Findings
Expanded under their line with evidence, a suggested fix and discussion; other findings stay compact. At most one filled button per finding.

### Navigation and focus
Focus rings are 2px sage, never removed. Controls are real buttons with accessible names. The rail marks the current section with `aria-current`.

## Do's and Don'ts

### Do:
- **Do** use tonal steps and 1px rules for structure.
- **Do** label generated text as generated, once per object.
- **Do** keep sage to one action or link per view.

### Don't:
- **Don't** add shadows, gradient text, glass, or eyebrow labels.
- **Don't** convey severity or diff state by color alone.
- **Don't** invent customers, benchmarks or pricing on the landing.
- **Don't** state sign-in access on the landing until it is decided.
- **Don't** correct the spelling "meteroite"; it is the brand.
