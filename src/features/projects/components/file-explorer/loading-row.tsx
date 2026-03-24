import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getItemPadding } from "./constants";

export const LoadingRow = ({
  className,
  level,
}: {
  className?: string;
  level: number;
}) => {
  return (
    <div
      className={cn("h-5.5 flex items-center text-muted-foreground", className)}
      style={{ paddingLeft: getItemPadding(level, true) }}
    >
      <Spinner className="size-4 text-ring ml-0.5" />
    </div>
  );
};
