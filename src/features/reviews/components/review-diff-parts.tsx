import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Findings may include code spans without requiring a Markdown renderer. */
export function InlineCode({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={index}
        className="rounded-md bg-review-file-header px-1 py-px text-review-text"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-review-text hover:bg-review-reading"
    >
      {children}
    </Button>
  );
}
