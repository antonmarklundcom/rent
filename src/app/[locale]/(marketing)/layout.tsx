import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

/**
 * The public marketing surface only (home, browse, listing detail, location
 * landing pages, about/contact, the English tourist page). Admin/panel/login/
 * cleaner screens sit outside this route group and keep just the shared
 * SiteHeader from the locale layout — S-3 (plan §6.S3) restyles those, not S-2.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
