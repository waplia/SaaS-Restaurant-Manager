import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StickyMobileCTA } from "@/components/shared/StickyMobileCTA";

export function SiteLayout({ children, hideStickyCta = false }: { children: ReactNode; hideStickyCta?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-background text-foreground overflow-x-hidden">
      <Header />
      <main className="flex-grow pb-16 lg:pb-0">{children}</main>
      <Footer />
      {!hideStickyCta && <StickyMobileCTA />}
    </div>
  );
}
