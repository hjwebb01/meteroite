/** Marks the cursor inside code sent to the model; never part of the file. */
export const CURSOR_MARKER = "<|cursor|>";

const ATTRIBUTE_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export const escapeAttribute = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ATTRIBUTE_ENTITIES[character]);

export const formatRelatedFiles = (
  files: readonly { path: string; signatures: string }[],
) =>
  `<related_files>\n${files
    .map(
      (file) =>
        `<file path="${escapeAttribute(file.path)}">\n${file.signatures}\n</file>`,
    )
    .join("\n")}\n</related_files>`;

/** Renders recent edits as compact `-`/`+` line diffs, oldest first. */
export const formatRecentEdits = (
  edits: readonly { before: string; after: string }[],
) =>
  edits
    .map((edit) => {
      const side = (prefix: string, text: string) =>
        text
          .split("\n")
          .map((line) => `${prefix}${line}`)
          .join("\n");
      return `@@\n${side("-", edit.before)}\n${side("+", edit.after)}`;
    })
    .join("\n");
