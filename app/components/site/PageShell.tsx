"use client";

import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import Reveal from "./Reveal";

/** Header, main area and footer used by every public page. */
export default function PageShell({ children, footer = true }: { children: React.ReactNode; footer?: boolean }) {
  return (
    <div className="ui-page">
      <SiteHeader />
      <Reveal />
      <main className="ui-main">{children}</main>
      {footer && <SiteFooter />}
    </div>
  );
}
