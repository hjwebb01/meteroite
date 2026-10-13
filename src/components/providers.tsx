"use client";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider } from "./theme-provider";
import { UnauthenticatedView } from "@/features/auth/components/unauthenticated-view";
import { AuthLoadingView } from "@/features/auth/components/auth-loading-view";
import { TooltipProvider } from "./ui/tooltip";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorBackground: "#262626",
          colorForeground: "#f1f1ef",
          colorMuted: "#303030",
          colorMutedForeground: "#c4c5bf",
          colorPrimary: "#8fa68e",
          colorPrimaryForeground: "#1c1c1c",
          colorNeutral: "#f1f1ef",
          colorInput: "#1c1c1c",
          colorInputForeground: "#f1f1ef",
          colorBorder: "#5a5a5a",
          colorRing: "#8fa68e",
          colorDanger: "#f3c3bb",
          colorSuccess: "#cfe3cc",
          colorWarning: "#e6c98a",
          colorModalBackdrop: "#0e0e0e",
          fontFamily: "var(--font-sans-face), system-ui, sans-serif",
          fontFamilyButtons: "var(--font-sans-face), system-ui, sans-serif",
          fontFamilyMono: "var(--font-code-face), ui-monospace, monospace",
          fontSize: "0.9375rem",
          borderRadius: "0px",
        },
      }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider>
            <Authenticated>{children}</Authenticated>
            <Unauthenticated>
              <UnauthenticatedView />
            </Unauthenticated>
            <AuthLoading>
              <AuthLoadingView />
            </AuthLoading>
          </TooltipProvider>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};
