"use client";

import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

/** Header, main area and footer used by every public page. */
export default function PageShell({ children, footer = true }: { children: React.ReactNode; footer?: boolean }) {
  return (
    <div className="ui-page">
      <SiteHeader />
      <main className="ui-main">{children}</main>
      {footer && <SiteFooter />}
    </div>
  );
}
