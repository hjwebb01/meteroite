
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://4c6ddb1f6239e4020e705001b0df025d@o4510935626481664.ingest.us.sentry.io/4510936103714816",

  tracesSampleRate: 1,


  integrations: [
    Sentry.vercelAIIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],
});
