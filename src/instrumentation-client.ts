
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://4c6ddb1f6239e4020e705001b0df025d@o4510935626481664.ingest.us.sentry.io/4510936103714816",

  integrations: [Sentry.replayIntegration()],

  tracesSampleRate: 1,

  replaysSessionSampleRate: 0.1,

  replaysOnErrorSampleRate: 1.0,

});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
