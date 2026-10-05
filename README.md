# Meteroite

Meteroite is an AI coding IDE that runs in your browser. Describe what you want to build, and an AI agent creates and edits the files for you. You can see the result running live next to your code.

## What you can do

- **Chat with an AI agent** that reads, writes, and deletes files in your project.
- **Edit code** in a full editor with syntax highlighting, inline AI suggestions, and quick edits.
- **See a live preview** of your app with a built-in terminal. It runs in your browser, so nothing is installed on your machine.
- **Import from or export to GitHub** to bring in an existing repo or save your work.
- **Start from a prompt**: type an idea and Meteroite creates a new project for you.

## Using Meteroite (no setup)

If someone has already deployed Meteroite for you, you only need the link.

1. Open the link and sign in.
2. Create a project, either from a prompt or by importing a GitHub repo.
3. Ask the AI in the chat panel to build or change something.
4. Watch the preview update, and edit files by hand whenever you like.

Use a Chromium-based browser (Chrome, Edge, Brave). The live preview relies on WebContainers, which work best there.

## Running it yourself

### What you need

| Requirement | Why |
| --- | --- |
| [Node.js](https://nodejs.org) 20 or newer | Runs the app |
| A [Convex](https://convex.dev) account | Database and file storage |
| A [Clerk](https://clerk.com) account | Sign-in. Also enable the GitHub social connection for import/export. |
| An [OpenRouter](https://openrouter.ai) API key | Powers the AI models |
| A [Firecrawl](https://firecrawl.dev) API key | Lets the agent read web pages |
| [Inngest](https://inngest.com) (free local dev server) | Runs the AI agent and GitHub jobs in the background |
| A [Sentry](https://sentry.io) account (optional) | Error tracking |

### 1. Install

```bash
git clone https://github.com/hjwebb01/meteroite.git
cd meteroite
npm install
```

### 2. Set up your keys

Create a file named `.env.local` in the project root:

```bash
# Convex (filled in for you by `npx convex dev`)
NEXT_PUBLIC_CONVEX_URL=

# Clerk (Dashboard > API Keys)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_ISSUER_DOMAIN=        # Clerk Dashboard > JWT templates > "convex" > Issuer

# AI and web access
OPENROUTER_API_KEY=
FIRECRAWL_API_KEY=

# Shared secret between the app and Convex. Make up a long random string.
METEROITE_CONVEX_INTERNAL_KEY=
```

Generate the secret with `openssl rand -hex 32`.

The same `CLERK_JWT_ISSUER_DOMAIN` and `METEROITE_CONVEX_INTERNAL_KEY` values must also be set in your Convex deployment (Convex Dashboard > Settings > Environment Variables).

In Clerk, create a JWT template named `convex` by choosing the Convex preset.

### 3. Start everything

Open three terminals in the project folder:

```bash
# Terminal 1: the database
npx convex dev

# Terminal 2: the web app
npm run dev

# Terminal 3: background jobs (AI agent, GitHub import/export)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Then open [http://localhost:3000](http://localhost:3000).

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development mode |
| `npm run build` | Build for production |
| `npm start` | Run the production build |
| `npm run lint` | Check code for problems |
| `npm run format` | Auto-format all files |

## Troubleshooting

- **The AI never replies.** The Inngest dev server (terminal 3) isn't running, or it can't reach `http://localhost:3000/api/inngest`.
- **Sign-in works but data won't load.** Check the Clerk `convex` JWT template and that `CLERK_JWT_ISSUER_DOMAIN` is set in the Convex dashboard too.
- **Live preview is blank.** Use Chrome, Edge, or Brave. The app already sends the required cross-origin headers.
- **GitHub import/export fails.** Make sure the GitHub connection is enabled in Clerk and you signed in with it.

## For developers

### Tech stack

Next.js 16 (App Router) and React 19, Convex, Clerk, CodeMirror 6, WebContainers, OpenRouter via the Vercel AI SDK, Inngest with agent-kit, Tailwind CSS 4, and Sentry.

### Project layout

```
convex/          Database schema and backend functions
src/app/         Pages and API routes (messages, github, suggestion, quick-edit)
src/features/    Feature modules: conversations, editor, preview, projects, auth
src/inngest/     Inngest client and function registry
src/lib/         Shared helpers (Convex, GitHub, OpenRouter, Firecrawl)
docs/            Design notes, including docs/stack-review.md
```

### How it fits together

1. The browser talks to Convex for live project and file data, signed in through Clerk.
2. Chat messages go to a Next.js API route, which hands them to Inngest.
3. An Inngest job runs the AI agent, which edits files in Convex through tools.
4. The editor and preview update automatically because Convex queries are reactive.

For architecture notes and known issues, see [docs/stack-review.md](docs/stack-review.md).
