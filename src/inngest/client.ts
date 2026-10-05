import { Inngest } from "inngest";
import { sentryMiddleware } from "@inngest/middleware-sentry";
// Create a client to send and receive events
export const inngest = new Inngest({
  id: "meteroite",
  isDev: process.env.NODE_ENV !== "production",
  middleware: [sentryMiddleware()],
});
