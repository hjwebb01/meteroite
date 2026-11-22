# Build, lint and script constraints

Constraints from the toolchain and from local verification that are invisible in the config files themselves. These rules were code comments.

## Decisions

- `eslint.config.mjs` (`...fixupConfigRules([...nextVitals, ...nextTs]),`): Next's React, import, and accessibility plugins still use pre-v10 rule APIs.
- `next.config.ts` (`telemetry: verificationMode ? false : undefined,`): Local verification must not upload plugin telemetry.
- `next.config.ts` (`sourcemaps: {`): Local verification must never contact Sentry or upload source maps.
- `scripts/check-convex-modules.mjs` (`import { existsSync, readdirSync } from "node:fs";`): Convex rejects deployed module paths containing characters other than letters, digits, underscores, and periods, but only at deploy time. Mirrors the CLI's entry-point rules (convex/dist/cli.bundle.cjs `entryPoints`) so `convex/lib/foo-bar.ts` fails here instead.
- `scripts/check-convex-modules.mjs` (`(base.match(/\./g) ?? []).length <= 1 &&`): Multiple dots (foo.test.ts, auth.config.ts) are skipped by the CLI.
- `scripts/check-convex-modules.mjs` (`if (existsSync(path.join(full, "convex.config.ts"))) return [];`): Nested components are bundled separately.
- `scripts/check-env.mjs` (`import { existsSync, readFileSync } from "node:fs";`): Reports which end-to-end flows can run locally, so verification stops at a named missing secret instead of a mocked test.
- `scripts/check-env.mjs` (`const deployKeyMismatch = () => {`): Mirrors convexDeployKeyProblem in src/lib/convex-client.ts: a preview key or another deployment's key is present but every admin call is unauthorized.
- `scripts/check-env.mjs` (`const TEST_USER = "meteroite-agent+clerk_test@example.com";`): Live review acceptance runs as the AGENTS.md test user, whose GitHub connection only a person can grant (Clerk OAuth in the browser).
- `scripts/check-models.mts` (`import { REVIEW_MODELS } from "../convex/lib/review_models.ts";`): Checks every hard-coded OpenRouter model ID against the live catalog, along with the capabilities its callers rely on. Run after changing any model list.
- `src/lib/convex-client.ts` (`export function convexDeployKeyProblem(): string | null {`): Cloud deploy keys look like `dev:<deployment>|…` or `prod:<deployment>|…`. Preview keys, or keys for another deployment, are rejected by Convex with a bare "Not authorized", so name the mismatch before any call is made.
