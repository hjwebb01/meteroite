import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { demoGenerate, demoError } from "@/inngest/functions";
import { processMessage } from "@/features/conversations/inngest/process-message";
export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [demoGenerate, demoError, processMessage],
});
