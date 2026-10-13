import type { Metadata } from "next";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const sans = Hanken_Grotesk({
  variable: "--font-sans-face",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
});

// Code, file paths and revision ids only.
const code = Spline_Sans_Mono({
  variable: "--font-code-face",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "Meteroite · Private code review",
  description:
    "Understand unfamiliar pull requests through a change brief, exact source evidence, and private review discussions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${sans.variable} ${code.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers>
          <Toaster theme="dark" />
          {children}
        </Providers>
      </body>
    </html>
  );
}
