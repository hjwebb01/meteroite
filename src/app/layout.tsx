import type { Metadata } from "next";
import {
  Hedvig_Letters_Serif,
  Schibsted_Grotesk,
  Spline_Sans_Mono,
} from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Display, UI, and code faces (DESIGN.md, "Typography").
const display = Hedvig_Letters_Serif({
  variable: "--font-display-face",
  subsets: ["latin"],
  axes: ["opsz"],
});

const grotesk = Schibsted_Grotesk({
  variable: "--font-ui-face",
  subsets: ["latin"],
});

const code = Spline_Sans_Mono({
  variable: "--font-code-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meteroite · Private code review",
  description:
    "Review pull requests with source evidence and private discussions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${display.variable} ${grotesk.variable} ${code.variable} antialiased`}
      >
        <Providers>
          <Toaster />
          {children}
        </Providers>
      </body>
    </html>
  );
}
