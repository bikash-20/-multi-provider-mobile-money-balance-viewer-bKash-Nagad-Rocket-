import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/features/shell/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "WalletSync — Multi-Provider Balance Viewer",
  applicationName: "WalletSync",
  description:
    "Manually tracked balances for bKash, Nagad, and Rocket. Read-only personal view, no provider API calls.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "WalletSync",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-touch-fullscreen": "yes",
  },
};

/*
  THEME_BOOT — mirrors LiquiGuard's inline boot script. Reads the
  walletsync.theme key (zustand-persisted state shape) and applies the
  matching `dark` class to <html> before React hydrates, so there is no
  flash of wrong theme on reload.

  Why this can't use useEffect: hydration race would render light mode
  first, then snap to dark — visible flash on every page reload. The
  inline script is the standard fix in this stack.
*/
const THEME_BOOT = `
(function () {
  try {
    var raw = localStorage.getItem("walletsync.theme");
    var mode = "light";
    if (raw) {
      var parsed = JSON.parse(raw);
      mode = parsed && parsed.state && parsed.state.mode ? parsed.state.mode : "light";
    }
    var resolved = mode === "dark" ? "dark" : mode === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : "light";
    if (resolved === "dark") document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = resolved;
  } catch (_) { /* default to light */ }
})();
`.trim();

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0F14" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // lang="en" matches the actual UI strings ("Total Balance", "Recent
    // Entries"). Screen readers will apply English pronunciation rules
    // instead of Bengali ones. The Hind Siliguri / Noto Sans Bengali
    // fallback in the body font stack is preserved at zero cost, so any
    // future Bengali label renders correctly without a new font load.
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body className="min-h-screen bg-base font-sans text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
