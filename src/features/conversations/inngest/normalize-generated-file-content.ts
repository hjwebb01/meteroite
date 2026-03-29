/**
 * Some tool-call payloads send whole files as one line with escaped `\n` sequences.
 * Expand those when the content has no real newlines but many escape sequences.
 */
export function normalizeGeneratedFileContent(content: string): string {
  if (content.includes("\n") || content.includes("\r")) {
    return content;
  }

  const escapedNewlineCount = (content.match(/\\r\\n|\\n|\\r/g) ?? []).length;
  if (escapedNewlineCount < 2) {
    return content;
  }

  return content
    .replace(/\\r\\n/g, "\r\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
}
