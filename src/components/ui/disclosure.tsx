import { cn } from "@/lib/utils";

function Disclosure({
  className,
  boxed = false,
  ...props
}: React.ComponentProps<"details"> & { boxed?: boolean }) {
  return (
    <details
      data-slot="disclosure"
      className={cn(boxed && "rounded-md border p-3", className)}
      {...props}
    />
  );
}

function DisclosureSummary({
  className,
  ...props
}: React.ComponentProps<"summary">) {
  return (
    <summary
      data-slot="disclosure-summary"
      className={cn(
        "cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

export { Disclosure, DisclosureSummary };
