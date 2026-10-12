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
          colorBackground: "#1d1813",
          colorForeground: "#f2e9db",
          colorMutedForeground: "#a49784",
          colorPrimary: "#f2e9db",
          colorPrimaryForeground: "#16120e",
          colorNeutral: "#f2e9db",
          colorInput: "#16120e",
          colorInputForeground: "#f2e9db",
          fontFamily: "var(--font-ui-face), sans-serif",
          borderRadius: "6px",
        },
      }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
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
