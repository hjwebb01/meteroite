import { Inngest } from "inngest";
import { sentryMiddleware } from "@inngest/middleware-sentry";
export const inngest = new Inngest({
  id: "meteroite",
  isDev: process.env.NODE_ENV !== "production",
  middleware: [sentryMiddleware()],
});
