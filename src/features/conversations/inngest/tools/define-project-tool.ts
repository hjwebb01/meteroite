import { createTool } from "@inngest/agent-kit";
import { z } from "zod";

import type { MessageProgressReporter } from "../message-progress";

interface ProjectToolOptions<
  Parameters extends z.ZodType,
  Schema extends z.ZodType,
  Prepared,
> {
  name: string;
  description: string;
  parameters: Parameters;
  validation?: Schema;
  reporter: Pick<MessageProgressReporter, "toolStart" | "toolEnd">;
  prepare?: (params: z.output<Schema>) => Promise<Prepared | string>;
  label: (params: Prepared) => string | undefined;
  run: (params: Prepared) => Promise<string>;
  errorPrefix?: string;
  formatError?: (message: string, params: Prepared) => string;
}

export function defineProjectTool<
  Parameters extends z.ZodType,
  Schema extends z.ZodType = Parameters,
  Prepared = z.output<Schema>,
>({
  name,
  description,
  parameters,
  validation,
  reporter,
  prepare,
  label,
  run,
  errorPrefix = "Error",
  formatError,
}: ProjectToolOptions<Parameters, Schema, Prepared>) {
  return createTool({
    name,
    description,
    parameters,
    handler: async (params, { step }) => {
      const parsed = (validation ?? parameters).safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0]?.message ?? "Invalid parameters"}`;
      }

      // Preflight checks run before progress starts, as in the original tools.
      const prepared = prepare
        ? await prepare(parsed.data as z.output<Schema>)
        : (parsed.data as Prepared);
      if (typeof prepared === "string") {
        return prepared;
      }
      const progressId = await reporter.toolStart(name, label(prepared));

      try {
        const result = await step?.run(
          name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          () => run(prepared),
        );
        await reporter.toolEnd(progressId, true);
        return result ?? "";
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await reporter.toolEnd(progressId, false, message);
        return formatError
          ? formatError(message, prepared)
          : `${errorPrefix}: ${message}`;
      }
    },
  });
}
