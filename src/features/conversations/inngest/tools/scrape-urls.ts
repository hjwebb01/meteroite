import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { firecrawl } from "@/lib/firecrawl";
import type { MessageProgressReporter } from "../message-progress";

const paramsSchema = z.object({
  urls: z
    .array(z.url("Invalid URL format"))
    .min(1, "Provide at least one URL to scrape"),
});

interface ScrapeUrlsToolOptions {
  reporter: MessageProgressReporter;
}

const MAX_MARKDOWN_PER_URL = 24_000;
const MAX_SCRAPED_TOTAL = 80_000;

function truncateMarkdownChunk(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}\n\n[… truncated ${text.length - maxLen} characters …]`;
}

export const createScrapeUrlsTool = ({ reporter }: ScrapeUrlsToolOptions) => {
  return defineProjectTool({
    name: "scrapeUrls",
    description:
      "Scrape content from URLs to get documentation or reference material. Use this when the user provides URLs or references external documentation. Returns markdown content from the scraped pages.",
    parameters: z.object({
      urls: z.array(z.string()).describe("Array of URLs to scrape for content"),
    }),
    validation: paramsSchema,
    reporter,
    label: ({ urls }) => {
      return urls.length === 1
        ? urls[0]
        : `${urls.length} URLs (${urls[0] ?? ""}${urls.length > 1 ? ", …" : ""})`;
    },
    errorPrefix: "Error scraping URLs",
    run: async ({ urls }) => {
      const results: { url: string; content: string }[] = [];
      let totalChars = 0;

      for (const url of urls) {
        try {
          const result = await firecrawl.scrape(url, {
            formats: ["markdown"],
          });

          if (result.markdown) {
            let md = truncateMarkdownChunk(
              result.markdown,
              MAX_MARKDOWN_PER_URL,
            );
            const remaining = MAX_SCRAPED_TOTAL - totalChars;
            if (remaining <= 0) {
              results.push({
                url,
                content:
                  "[… omitted: per-response scrape budget already used by earlier URLs …]",
              });
              continue;
            }
            if (md.length > remaining) {
              md = `${md.slice(0, remaining)}\n\n[… truncated to fit scrape budget …]`;
            }
            totalChars += md.length;
            results.push({
              url,
              content: md,
            });
          }
        } catch {
          results.push({
            url,
            content: `Failed to scrape URL: ${url}`,
          });
        }
      }

      if (results.length === 0) {
        return "No content could be scraped from the provided URLs.";
      }

      return JSON.stringify(results);
    },
  });
};
