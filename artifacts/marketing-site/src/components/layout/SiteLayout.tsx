import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-background text-foreground">
      <Header />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}
