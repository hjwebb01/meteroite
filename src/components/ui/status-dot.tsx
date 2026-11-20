import { cn } from "@/lib/utils";

function StatusDot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full bg-current", className)}
      {...props}
    />
  );
}

export { StatusDot };
