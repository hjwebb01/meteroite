import { generateText } from "ai";
import { inngest } from "./client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

export const demoGenerate = inngest.createFunction(
    { id: "demo-generate" },
    { event: "demo/generate" },
    async ({ step }) => {
        await step.run("generate-text", async () => {
            return await generateText({
                model: openrouter.chat("openrouter/free"),
                prompt: "Write a short story about a cat.",
            });
        });
    },
);