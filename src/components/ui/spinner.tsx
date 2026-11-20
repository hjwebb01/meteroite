import LoaderLines from "@boxicons/react/LoaderLines";

import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderLines
      role="status"
      aria-label="Loading"
      className={cn(
        "size-4 shrink-0 animate-spin motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
