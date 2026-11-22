import { Button } from "@/components/ui/button";

export function ReadingProgress({
  readCount,
  total,
  onOpenNext,
}: {
  readCount: number;
  total: number;
  onOpenNext: () => void;
}) {
  return (
    <>
      <div
        role="progressbar"
        aria-label="Groups read"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={readCount}
        className="h-2 w-full overflow-hidden rounded-full bg-review-border"
      >
        <div
          className="h-full bg-review-link"
          style={{ width: `${(readCount / total) * 100}%` }}
        />
      </div>
      {readCount < total ? (
        <Button
          className="h-auto min-h-11 w-full whitespace-normal text-sm sm:w-auto"
          onClick={onOpenNext}
        >
          Next unread group
        </Button>
      ) : null}
    </>
  );
}
