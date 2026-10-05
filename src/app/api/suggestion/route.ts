import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { openRouter } from "@/lib/openrouter";
import { auth } from "@clerk/nextjs/server";

const suggestionSchema = z.object({
  edits: z.array(
    z.object({
      anchor: z
        .string()
        .describe(
          "Exact existing text to replace, or empty for insertion at cursor.",
        ),
      replacement: z.string(),
    }),
  ),
});

const SUGGESTION_PROMPT = `You are a code suggestion assistant.

<context>
<file_name>{fileName}</file_name>
<previous_lines>
{previousLines}
</previous_lines>
<current_line number="{lineNumber}">{currentLine}</current_line>
<before_cursor>{textBeforeCursor}</before_cursor>
<after_cursor>{textAfterCursor}</after_cursor>
<next_lines>
{nextLines}
</next_lines>
<full_code>
{code}
</full_code>
{relatedFiles}{recentEdits}</context>

<instructions>
If full_code begins with "[…]" or ends with "[…]", it is a cursor-centered excerpt of a larger file (not the whole file). Still use previous_lines, current_line, and next_lines as the primary local context.

Return edits as { anchor, replacement }. Use an empty anchor to insert at the cursor. For a change elsewhere, anchor must be exact, unique existing text from full_code. Prefer continuing the user's recent edits, including a related rename elsewhere. Return an empty edits array when no useful change is needed. Never insert code already present.

If related_files is present, it lists exported signatures from other Project files this file imports or has open in other tabs. Use their exact names and argument shapes, and never reproduce their bodies.

If recent_edits is present, it lists the user's latest changes (oldest first) with the lines before and after each change. Continue that change: for example, use a new name the user just introduced instead of the old one.

Your suggestion is inserted immediately after the cursor, so never suggest code that's already in the file.
</instructions>`;

const requestSchema = z.object({
  fileName: z.string(),
  code: z.string().min(1),
  currentLine: z.string(),
  previousLines: z.string().optional(),
  textBeforeCursor: z.string(),
  textAfterCursor: z.string(),
  nextLines: z.string().optional(),
  lineNumber: z.number(),
  relatedFiles: z
    .array(z.object({ path: z.string(), signatures: z.string() }))
    .optional(),
  recentEdits: z
    .array(
      z.object({
        startLine: z.number(),
        endLine: z.number(),
        before: z.string(),
        after: z.string(),
      }),
    )
    .optional(),
});

const relatedFilesSection = (
  files: z.infer<typeof requestSchema>["relatedFiles"],
) =>
  files?.length
    ? `<related_files>\n${files
        .map(
          (file) => `<file path="${file.path}">\n${file.signatures}\n</file>`,
        )
        .join("\n")}\n</related_files>\n`
    : "";

const recentEditsSection = (
  edits: z.infer<typeof requestSchema>["recentEdits"],
) =>
  edits?.length
    ? `<recent_edits>\n${edits
        .map(
          (edit) =>
            `<edit lines="${edit.startLine}-${edit.endLine}">\n<before>${edit.before}</before>\n<after>${edit.after}</after>\n</edit>`,
        )
        .join("\n")}\n</recent_edits>\n`
    : "";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }
    const body = parsed.data;
    // Replacer functions keep `$` sequences in user code from being treated as patterns.
    const values: Record<string, string> = {
      fileName: body.fileName,
      code: body.code,
      previousLines: body.previousLines ?? "",
      currentLine: body.currentLine,
      textBeforeCursor: body.textBeforeCursor,
      textAfterCursor: body.textAfterCursor,
      nextLines: body.nextLines ?? "",
      lineNumber: body.lineNumber.toString(),
      relatedFiles: relatedFilesSection(body.relatedFiles),
      recentEdits: recentEditsSection(body.recentEdits),
    };
    const prompt = SUGGESTION_PROMPT.replace(
      /\{(\w+)\}/g,
      (match, key: string) => values[key] ?? match,
    );

    const { output } = await generateText({
      model: openRouter.chat("qwen/qwen3-coder-next"),
      output: Output.object({ schema: suggestionSchema }),
      prompt,
    });
    const normalized = suggestionSchema.safeParse(output);
    return NextResponse.json({
      edits: normalized.success
        ? normalized.data.edits.filter(
            (edit) => edit.anchor !== edit.replacement,
          )
        : [],
    });
  } catch (error) {
    console.error("Error generating suggestion:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestion" },
      { status: 500 },
    );
  }
}
