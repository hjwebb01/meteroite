import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { openRouter } from "@/lib/openrouter";
import { auth } from "@clerk/nextjs/server";
import { firecrawl } from "@/lib/firecrawl";

const quickEditSchema = z.object({
  editedCode: z
    .string()
    .describe(
      "The edited version of the selected code based on the instruction",
    ),
});
const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

const MAX_FULL_CODE_CONTEXT_CHARS = 20_000;
const MAX_DOC_MARKDOWN_PER_URL = 12_000;
const MAX_DOC_MARKDOWN_TOTAL = 40_000;

function truncateForPrompt(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n[… truncated ${text.length - max} characters …]`;
}

/** When the file is large, send a window around the selection instead of the whole buffer. */
function buildFullCodeContext(fullCode: string, selectedCode: string): string {
  const raw = fullCode ?? "";
  if (raw.length <= MAX_FULL_CODE_CONTEXT_CHARS) {
    return raw;
  }
  const trimmed = selectedCode.trim();
  if (!trimmed) {
    return truncateForPrompt(raw, MAX_FULL_CODE_CONTEXT_CHARS);
  }
  const idx = raw.indexOf(selectedCode);
  if (idx === -1) {
    return truncateForPrompt(raw, MAX_FULL_CODE_CONTEXT_CHARS);
  }
  const selLen = selectedCode.length;
  const budget = MAX_FULL_CODE_CONTEXT_CHARS;
  if (selLen >= budget) {
    return truncateForPrompt(selectedCode, budget);
  }
  // Reserve ~40 chars for omission markers; clamp so slack is never negative (that would
  // shrink the window inside the selection when selLen is just under budget).
  const slack = Math.max(0, budget - selLen - 40);
  const before = Math.floor(slack / 2);
  const after = slack - before;
  const start = Math.max(0, idx - before);
  const end = Math.min(raw.length, idx + selLen + after);
  let out = raw.slice(start, end);
  if (start > 0) {
    out = `[… ${start} characters omitted …]\n${out}`;
  }
  if (end < raw.length) {
    out = `${out}\n[… ${raw.length - end} characters omitted …]`;
  }
  return out;
}

const QUICK_EDIT_PROMPT = `You are a code editing assistant. Edit the selected code based on the user's instruction.

<context>
<selected_code>
{selectedCode}
</selected_code>
<full_code_context>
{fullCode}
</full_code_context>
</context>

{documentation}

<instruction>
{instruction}
</instruction>

<instructions>
Return ONLY the edited version of the selected code.
Maintain the same indentation level as the original.
Do not include any explanations or comments unless requested.
If the instruction is unclear or cannot be applied, return the original code unchanged.
</instructions>`;

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { selectedCode, fullCode, instruction } = await request.json();

    if (!selectedCode) {
      return NextResponse.json(
        { error: "Selected code is required" },
        { status: 400 },
      );
    }
    if (!instruction) {
      return NextResponse.json(
        { error: "Instruction is required" },
        { status: 400 },
      );
    }
    const urls: string[] = instruction.match(URL_REGEX) || [];
    let documentation = "";
    if (urls.length > 0) {
      const docParts: string[] = [];
      let docTotal = 0;
      for (const url of urls) {
        const remaining = MAX_DOC_MARKDOWN_TOTAL - docTotal;
        if (remaining <= 0) {
          break;
        }
        try {
          const result = await firecrawl.scrape(url, {
            formats: ["markdown"],
          });
          if (result.markdown) {
            let md = result.markdown;
            if (md.length > MAX_DOC_MARKDOWN_PER_URL) {
              md = `${md.slice(0, MAX_DOC_MARKDOWN_PER_URL)}\n\n[… truncated …]`;
            }
            if (md.length > remaining) {
              md = `${md.slice(0, remaining)}\n\n[… truncated to documentation budget …]`;
            }
            docTotal += md.length;
            docParts.push(`<doc url="${url}">\n${md}\n</doc>`);
          }
        } catch {
          // skip failed URL
        }
      }
      if (docParts.length > 0) {
        documentation = `<documentation>\n${docParts.join("\n\n")}\n</documentation>`;
      }
    }
    const fullCodeContext = buildFullCodeContext(
      typeof fullCode === "string" ? fullCode : "",
      selectedCode,
    );
    const prompt = QUICK_EDIT_PROMPT.replace("{selectedCode}", selectedCode)
      .replace("{fullCode}", fullCodeContext)
      .replace("{instruction}", instruction)
      .replace("{documentation}", documentation);

    const { output } = await generateText({
      model: openRouter.chat("qwen/qwen3-coder-next"),
      output: Output.object({ schema: quickEditSchema }),
      prompt,
    });
    return NextResponse.json({ editedCode: output.editedCode });
  } catch (error) {
    console.error("Edit error:", error);
    return NextResponse.json(
      { error: "Failed to generate edited code" },
      { status: 500 },
    );
  }
}
