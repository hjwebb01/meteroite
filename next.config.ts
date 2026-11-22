import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const verificationMode = process.env.METEROITE_VERIFY_NO_UPLOAD === "1";

const nextConfig: NextConfig = {
};

const sentryBuildOptions = {
  org: "hunter-webb",

  project: "meteroite",

  telemetry: verificationMode ? false : undefined,

  sourcemaps: {
    disable: verificationMode,
  },

  silent: !process.env.CI,

  widenClientFileUpload: true,

  tunnelRoute: process.env.NODE_ENV === "development" ? undefined : "/monitoring",

  webpack: {
    automaticVercelMonitors: true,

    treeshake: {
      removeDebugLogging: true,
    },
  },
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
