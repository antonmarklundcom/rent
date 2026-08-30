import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";

/**
 * Shared chrome for the owner panel (plan §6.S3): just the toast host every
 * `ActionForm` here reports into (fix #5) — the panel is two route shapes
 * (`/panel`, `/panel/publicaciones/[id]`), not enough surface to need its own
 * sidebar nav on top of `SiteHeader`'s existing "Panel" link.
 */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="wrap py-6 md:py-10">{children}</div>
    </ToastProvider>
  );
}
