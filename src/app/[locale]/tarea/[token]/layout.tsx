import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";

/**
 * Toast host for the cleaner magic-link page (fix #5) — the checklist,
 * upload and advance forms here are the same `ActionForm` pattern that loses
 * its confirmation on unmount elsewhere. No other chrome: this route has no
 * login and needs none added (plan §2).
 */
export default function CleanerTaskLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="wrap py-6">{children}</div>
    </ToastProvider>
  );
}
