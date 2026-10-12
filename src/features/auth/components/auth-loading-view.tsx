import { Spinner } from "@/components/ui/spinner";

export const AuthLoadingView = () => {
  return (
    <div
      role="status"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-review-bg text-review-muted"
    >
      <Spinner aria-hidden="true" className="size-5 text-review-link" />
      <p className="text-xs">Opening your workspace…</p>
    </div>
  );
};
