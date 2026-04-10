# Agents

## Cursor Cloud specific instructions

### Project overview

Meteroite is an AI-powered web IDE built with Next.js 16 (App Router, Turbopack) + Convex (cloud real-time database) + Clerk (authentication) + Inngest (background jobs). See `package.json` for scripts (`dev`, `build`, `lint`, `format`).

### Environment variables

All secrets are injected as Cloud Agent environment variables. Before starting the dev server, generate `.env.local` from them:

```bash
cat > .env.local << ENVEOF
NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
CLERK_JWT_ISSUER_DOMAIN=$CLERK_JWT_ISSUER_DOMAIN
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY
CONVEX_DEPLOYMENT=$CONVEX_DEPLOYMENT
METEROITE_CONVEX_INTERNAL_KEY=$METEROITE_CONVEX_INTERNAL_KEY
ENVEOF
```

### Running services

- **Next.js dev server**: `npm run dev` (port 3000). This is the only service you need to start locally.
- **Convex backend**: Runs as a cloud service. The env vars `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` connect the app to the hosted deployment. You do NOT need to run `npx convex dev` locally (it requires interactive login).
- **Inngest**: The Inngest handler is exposed at `/api/inngest`. For local development with Inngest event processing, run `npx inngest-cli@latest dev` separately, but it is not required for basic app functionality.

### Lint / Build / Test

- **Lint**: `npm run lint` (ESLint, flat config in `eslint.config.mjs`)
- **Build**: `npm run build` (Next.js production build with Turbopack)
- **Format**: `npm run format` (Prettier)
- No automated test suite exists in this project.

### Gotchas

- `@codemirror/lang-javascript` and `@codemirror/view` are installed from GitHub refs (not npm registry). If `npm install` fails on these, check network access.
- The `isbinaryfile` package requires Node >= 24 but works on Node 22 with warnings. This is non-blocking.
- Sentry config (`next.config.ts`) wraps the Next config with `withSentryConfig`. Build works without `SENTRY_AUTH_TOKEN` but source map uploads will be skipped.
- The Convex MCP tool requires a local Convex login token (`npx convex dev` interactive auth). Without it, use the Convex dashboard or direct API calls via the app's env vars.
