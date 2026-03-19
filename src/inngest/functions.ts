import { generateText } from "ai";
import { inngest } from "./client";
import { openRouter } from "@/lib/openrouter";
import { firecrawl } from "@/lib/firecrawl";

const URL_REGEX = /https?:\/\/[^\s]+/g;

export const demoGenerate = inngest.createFunction(
    { id: "demo-generate" },
    { event: "demo/generate" },
    async ({ event, step }) => {
        const { prompt } = event.data as { prompt: string };

        const urls = await step.run("extract-urls", async () => {
            return prompt.match(URL_REGEX) ?? [];
        }) as string[];

        const content = await step.run("extract-content", async () => {
            const results = await Promise.all(urls.map(async (url) => {
                const result = await firecrawl.scrape(
                    url,
                    { formats: ["markdown"] },
                );
                return result.markdown ?? null;
            }));
            return results.filter(Boolean).join("\n\n");
        });

        const finalPrompt = content
            ? `Context:\n${content}\n\nQuestion: ${prompt}`
            : prompt;


        await step.run("generate-text", async () => {
            return await generateText({
                model: openRouter.chat("openrouter/free"),
                prompt: finalPrompt,
                experimental_telemetry: {
                    isEnabled: true,
                    recordInputs: true,
                    recordOutputs: true,
                },
            });
        });
    },
);

export const demoError = inngest.createFunction(
    { id: "demo-error" },
    { event: "demo/error" },
    async ({ step }) => {
        await step.run("fail", async () => {
            throw new Error("Inngest Error: Background job failed");
        });
    }
);