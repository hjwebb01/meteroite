"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  BrainIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  FilePenLineIcon,
  FileSearchIcon,
  FolderIcon,
  GlobeIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useContext, useMemo } from "react";

interface ChainOfThoughtContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null,
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought",
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });

    const chainOfThoughtContext = useMemo(
      () => ({ isOpen, setIsOpen }),
      [isOpen, setIsOpen],
    );

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <div className={cn("not-prose w-full space-y-4", className)} {...props}>
          {children}
        </div>
      </ChainOfThoughtContext.Provider>
    );
  },
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen, setIsOpen } = useChainOfThought();

    return (
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
            className,
          )}
          {...props}
        >
          <BrainIcon className="size-4" />
          <span className="flex-1 text-left">
            {children ?? "Chain of Thought"}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </CollapsibleTrigger>
      </Collapsible>
    );
  },
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending" | "error";
  kind?: "phase" | "tool";
  toolName?: string;
  ordinal?: number;
  isLast?: boolean;
};

const stepStyles = {
  active: {
    card:
      "border-primary/20 bg-primary/5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    rail: "border-primary/25 bg-primary/10 text-primary",
    icon: "text-primary",
    label: "text-foreground",
    description: "text-foreground/75",
  },
  complete: {
    card: "border-border/60 bg-muted/30 text-muted-foreground",
    rail: "border-border bg-background text-muted-foreground",
    icon: "text-muted-foreground",
    label: "text-foreground/80",
    description: "text-muted-foreground",
  },
  pending: {
    card: "border-border/40 bg-transparent text-muted-foreground/70",
    rail: "border-border/50 bg-background text-muted-foreground/60",
    icon: "text-muted-foreground/60",
    label: "text-muted-foreground/80",
    description: "text-muted-foreground/70",
  },
  error: {
    card: "border-destructive/25 bg-destructive/5 text-destructive",
    rail: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: "text-destructive",
    label: "text-destructive",
    description: "text-destructive/80",
  },
};

function resolveStepIcon(
  kind: "phase" | "tool" | undefined,
  toolName: string | undefined,
  status: "complete" | "active" | "pending" | "error",
): LucideIcon {
  if (kind === "tool") {
    if (toolName === "listFiles" || toolName === "readFiles") {
      return FileSearchIcon;
    }
    if (
      toolName === "updateFile" ||
      toolName === "createFiles" ||
      toolName === "renameFile" ||
      toolName === "deleteFiles"
    ) {
      return FilePenLineIcon;
    }
    if (toolName === "createFolder") {
      return FolderIcon;
    }
    if (toolName === "scrapeUrls") {
      return GlobeIcon;
    }
    return WrenchIcon;
  }

  if (status === "error") {
    return CircleAlertIcon;
  }
  if (status === "active") {
    return LoaderCircleIcon;
  }
  if (status === "complete") {
    return CheckCircle2Icon;
  }
  return BrainIcon;
}

function renderStepIcon(
  icon: LucideIcon | undefined,
  kind: "phase" | "tool" | undefined,
  toolName: string | undefined,
  status: "complete" | "active" | "pending" | "error",
  className: string,
) {
  const ResolvedIcon = icon ?? resolveStepIcon(kind, toolName, status);
  return <ResolvedIcon className={className} />;
}

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon,
    label,
    description,
    status = "complete",
    kind,
    toolName,
    ordinal,
    isLast = false,
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const resolvedStatus = stepStyles[status];

    return (
      <div
        className={cn("grid grid-cols-[2rem_1fr] gap-3 text-sm", className)}
        {...props}
      >
        <div className="relative flex flex-col items-center pt-1">
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
              resolvedStatus.rail,
            )}
          >
            {ordinal ?? "•"}
          </div>
          {!isLast && (
            <div className="mt-2 h-full w-px bg-border/70" />
          )}
        </div>
        <div
          className={cn(
            "min-w-0 rounded-xl border px-3 py-2.5 transition-colors",
            resolvedStatus.card,
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {renderStepIcon(
              icon,
              kind,
              toolName,
              status,
              cn("size-4 shrink-0", resolvedStatus.icon),
            )}
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {kind === "tool" ? "Tool" : "Phase"}
            </span>
            {status === "active" && (
              <Badge
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
                variant="secondary"
              >
                Current
              </Badge>
            )}
            {status === "error" && (
              <Badge
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
                variant="destructive"
              >
                Error
              </Badge>
            )}
            {status === "complete" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CheckCircle2Icon className="size-3.5" />
                Complete
              </span>
            )}
          </div>
          <div className={cn("mt-2 min-w-0 font-medium", resolvedStatus.label)}>
            {label}
          </div>
          {description && (
            <div
              className={cn(
                "mt-1 break-words text-xs leading-relaxed",
                resolvedStatus.description,
              )}
            >
              {description}
            </div>
          )}
          {children && (
            <div className="mt-2 min-w-0 overflow-hidden">
              {children}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  ),
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn("gap-1 px-2 py-0.5 font-normal text-xs", className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  ),
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  /** When false, skip enter/exit motion on the body (e.g. live-updating step lists). */
  animateContent?: boolean;
};

export const ChainOfThoughtContent = memo(
  ({
    className,
    children,
    animateContent = true,
    ...props
  }: ChainOfThoughtContentProps) => {
    const { isOpen } = useChainOfThought();

    return (
      <Collapsible open={isOpen}>
        <CollapsibleContent
          className={cn(
            "mt-2 space-y-3",
            animateContent &&
              "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
            !animateContent && "text-popover-foreground outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </CollapsibleContent>
      </Collapsible>
    );
  },
);

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("mt-2 space-y-2", className)} {...props}>
      <div className="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
        {children}
      </div>
      {caption && <p className="text-muted-foreground text-xs">{caption}</p>}
    </div>
  ),
);

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults";
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtImage.displayName = "ChainOfThoughtImage";
