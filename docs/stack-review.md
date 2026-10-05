# Meteroite stack review

Meteroite is a browser-based AI coding IDE: CodeMirror editor, a file tree stored in
Convex, an AI coding agent that edits files, inline AI suggestions and quick edits, a
WebContainer live preview with a terminal, and GitHub import/export.

## Verdict

**No rewrite or stack swap is needed.** Next.js 16 + Convex + Clerk + CodeMirror 6 +
WebContainers + OpenRouter is a sensible, current stack for a browser IDE with
real-time file sync. Convex's reactive queries suit a live file tree well.

The weaknesses come from how the tutorial wired the pieces together, not from the
pieces themselves. Ranked by importance:

1. Ad hoc trust boundary between Next.js and Convex (security bugs today)
2. Two backends doing one job (Next API routes + Inngest bridged to Convex by a shared secret)
3. Two AI frameworks (Vercel AI SDK and Inngest agent-kit)
4. Dead weight from scaffolding (unused components and dependencies)
5. Correctness bugs in the preview sync and import job

## 1. Trust boundary: the `internalKey` pattern (fix now)

`convex/system.ts` exposes about 30 **public** Convex queries and mutations. Each is
guarded only by a shared secret (`METEROITE_CONVEX_INTERNAL_KEY`). Anyone with the key
acts as root over every project. Next.js API routes call these functions after checking
only that *some* user is logged in, so each route must re-implement ownership checks.
Most routes don't.

Confirmed IDORs (any signed-in user can act on another user's data by ID):

| Route | Effect |
| --- | --- |
| `POST /api/messages` | Post messages into, and run the agent against, any conversation. The agent can then read, write, and delete files in that project. |
| `POST /api/messages/cancel` | Cancel any project's running agent. |
| `POST /api/github/export` | Export any project's files to *your* GitHub account (data exfiltration). |
| `POST /api/github/export/cancel`, `/reset` | Alter any project's export status. |

Secret handling:

- `src/app/api/github/export/route.ts` puts `internalKey` **and** the user's GitHub OAuth
  token into the Inngest event payload. Inngest stores event payloads in its event log
  and dashboard. The import route also sends `githubToken` in the event.

Recommended fix (no new stack needed):

- Convert `system.ts` functions to `internalQuery` / `internalMutation` so the public
  API surface can't reach them. Call them from Convex actions or HTTP actions that verify
  a secret, or from a server using a deploy key. Alternatively, keep the key but **move
  ownership checks into Convex**: every system function takes the acting `userId` and
  verifies `project.ownerId` itself.
- For user-initiated routes, the simplest correct option is to call Convex **as the
  user**: `convex.setAuth(await getToken({ template: "convex" }))`. Then the existing
  ownership checks in `convex/projects.ts`, `files.ts`, and `conversations.ts` apply
  automatically.
- Never put secrets or OAuth tokens in event payloads. Fetch the GitHub token inside the
  Inngest step via `clerkClient().users.getUserOauthAccessToken(userId, "github")` and
  pass only `userId`.

## 2. Two backends doing one job (consider)

Chat runs through this chain: Next route → Convex (via key) → `inngest.send` → Inngest
function → agent-kit → tools → Convex (via key) → client subscription. Progress
reporting (`message-progress.ts`, about 250 lines) exists largely to get state back
across that bridge.

Convex already has durable background work: scheduled actions, the
`@convex-dev/workflow` component, and `@convex-dev/agent`, which persists threads and
messages and streams to clients. Moving chat and GitHub jobs into Convex actions would
remove the shared secret, the Inngest event plumbing, and most of the progress-reporting
code. Ownership checks would live in one place.

This is the one place where a "better stack" argument holds: **consolidate onto
Convex**, rather than adopt something new. It's a migration rather than a fix, so do it
after item 1 and only if you plan to keep developing the agent. Inngest is fine if you
like its dashboard and replay. The problem is the bridge, not Inngest.

## 3. Two AI frameworks (consider)

- `ai` (Vercel AI SDK v6) powers `/api/suggestion` and `/api/quick-edit`.
- `@inngest/agent-kit` (0.13, low adoption) powers the chat agent and title generation.
  It forced workarounds in `process-message.ts`:
  - `as any` casts to pass OpenRouter reasoning parameters.
  - The title agent can't run inside `step.run`.
  - A hand-rolled duplicate-tool-call detector in the router.
- `openai` is installed but never imported.

Standardizing on the AI SDK, with its tool loop or Agent, run inside Inngest steps or
Convex actions, gives one model and provider abstraction, typed provider options, and
streaming.

## 4. Dead weight (cheap cleanup)

- `src/components/ai-elements/`: the app imports 4 of 48 components (`conversation`,
  `message`, `prompt-input`, `chain-of-thought`). The rest are scaffolding.
- Dependencies used only by those dead components, or not at all: `openai`,
  `@hookform/resolvers`, `react-hook-form` (the app uses `@tanstack/react-form`),
  `react-resizable-panels` (the app uses `allotment`), `recharts`, `embla-carousel-react`,
  `react-day-picker`, `media-chrome`, `@rive-app/react-webgl2`, `@xyflow/react`,
  `react-jsx-parser`, `tokenlens`, `input-otp`, `vaul`, `ansi-to-react`, `motion`,
  `@streamdown/mermaid`, and others. Verify each with grep before removing.
- `src/inngest/functions.ts` (`demoGenerate`, `demoError`) is tutorial demo code and
  isn't registered.
- `@codemirror/view` and `@codemirror/lang-javascript` are installed from `github:` HEAD
  rather than npm releases. That makes builds non-reproducible across `npm install`
  runs. Pin to npm versions.
- The README is the create-next-app boilerplate.
- There are no tests. `tsc` passes and eslint reports 33 warnings and 0 errors.

## 5. Correctness bugs

- `src/features/projects/inngest/import-github-repo.ts:23`: `onFailure` reads
  `POLARIS_CONVEX_INTERNAL_KEY`, the tutorial's old name. The variable is never set, so a
  failed import never gets marked `failed` and stays "importing" forever.
- Import tries the `main` branch and falls back to `master`. Repos with any other
  default branch fail. Use `repos.get` → `default_branch`.
- `use-webcontainer.ts`:
  - The sync effect rewrites **every** file on **every** change, which causes an HMR
    storm.
  - Deletes and renames never propagate to the container.
  - Files emptied to `""` are skipped (`!file.content`).
  - The singleton container isn't scoped per project, so switching projects mounts the
    new project over the old filesystem.
  - Commands are split with `.split(" ")`, which breaks quoted arguments.
  - `terminalOutput` grows without bound.
- `buildFileTree`: a folder doc processed after its children overwrites them with
  `{ directory: {} }`. Use `??=`.
- `/api/suggestion` and `/api/quick-edit` have no request validation (zod is already a
  dependency), no rate limiting, and return 403 instead of 401 for unauthenticated
  requests. Any signed-in user can drive unlimited paid LLM and Firecrawl calls.

## 6. Scaling and licensing notes (no action yet)

- `files.getFiles` subscribes to every file's full content for the project. Each save
  re-sends the whole project to every subscriber. That's fine at tutorial size. Later,
  split metadata (tree) from content (per open file).
- WebContainers require a commercial license from StackBlitz for production use by
  for-profit companies. Check this before monetizing.

## Suggested order

1. Fix the IDORs and secret leaks (section 1, minimal version: run as user and
   ownership-check in Convex).
2. Fix the section 5 bugs.
3. Prune dead code and dependencies and pin the CodeMirror deps.
4. Optionally consolidate background work onto Convex, and AI onto the AI SDK.
