---
name: delete-comment
description: Audit code comments in this repo, delete them by category, record decisions in ADRs, file issues for excused hacks, and shrink the lint ratchet. Use for "/delete-comment", "clean up comments", or when the comment baseline should fall.
---

# Delete comments

Policy: `docs/adr/0001-no-code-comments.md`. Code carries no comments; `local/no-comments` enforces it and `eslint-suppressions.json` is the ratchet baseline.

## Steps

1. `node scripts/list-comments.mjs` lists every comment outside directives (`eslint-*`, `@ts-*`, `/// <reference>`, `@vitest-environment`) with the code line after it. Scope to a path by filtering its output. Read all of them; do not classify from the first line alone.
2. Classify each one:
   - **Tautology**: restates what the code shows. Delete.
   - **Stale**: names code, files, or behaviour that no longer exist. Check with `ls`/`grep`, then delete.
   - **Excuse**: justifies a hack, a swallowed error (`catch {}`), a lint suppression, a cast, or a placeholder value. Delete it and file an issue for the hack.
   - **Decision record**: a surprising, hard-to-reverse why that the code cannot show. Delete it and move it to an ADR.
   - **Keep** only: vendored `src/components/ui`, markers for work in progress such as `TIMING-TEMP`, and tool directives. Leave these in the baseline.
3. Excuses: group by hack, not by comment. `gh issue create` one issue per hack with the file paths and the original comment text, so the reasoning is not lost. Do not fix the hack in this pass.
4. Decisions: append to the ADR for that theme in `docs/adr/` as one bullet (file path, then the original text), or start a new numbered ADR (format in the `domain-modeling` skill's `ADR-FORMAT.md`) when no theme fits.
5. Delete the classified comments and nothing else. Confirm the diff removes only comment text or blank lines next to it.
6. `npm run lint:ratchet`, then `npm run typecheck` and `npm test`. The baseline in `eslint-suppressions.json` must only shrink; never add to it.
7. Report counts per category, the issues filed, the ADRs touched, and lines removed. CSS comments are not linted, so recheck them in the lister output.

## Guardrails

- Never delete a comment that sits in an empty `catch` without filing the excuse issue first.
- Do not delete `TIMING-TEMP` markers; they flag instrumentation that must be removed as code.
- A comment you are unsure about is a decision record until the code is shown to make it obvious.
