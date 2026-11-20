# Code carries no comments

Comments rot, repeat the code, or excuse a hack that then spreads. We delete them: a tautology or stale note is removed, a note excusing a workaround becomes an issue to fix the workaround, and a decision that is surprising and hard to reverse goes into an ADR here. Compiler and tool directives (`eslint-disable`, `@ts-*`, `/// <reference>`, `@vitest-environment`) are not comments and stay.

`local/no-comments` in `eslint.config.mjs` enforces this. Existing comments are grandfathered in `eslint-suppressions.json`, so the count can only fall; after deleting comments, run `npm run lint:ratchet` to shrink the file. Vendored shadcn files in `src/components/ui` stay in the baseline so `shadcn add` does not churn. Repeat the audit with the `delete-comment` skill.
