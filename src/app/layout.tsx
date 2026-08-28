import type { ReactNode } from "react";

/**
 * Root layout is intentionally a pass-through: `<html>`/`<body>` are rendered
 * by the locale layout so `lang` always matches the active locale.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
