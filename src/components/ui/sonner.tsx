"use client";

import CheckCircle from "@boxicons/react/CheckCircle";
import InfoCircle from "@boxicons/react/InfoCircle";
import LoaderLines from "@boxicons/react/LoaderLines";
import AlertOctagon from "@boxicons/react/AlertOctagon";
import AlertTriangle from "@boxicons/react/AlertTriangle";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle className="size-4" />,
        info: <InfoCircle className="size-4" />,
        warning: <AlertTriangle className="size-4" />,
        error: <AlertOctagon className="size-4" />,
        loading: <LoaderLines className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
