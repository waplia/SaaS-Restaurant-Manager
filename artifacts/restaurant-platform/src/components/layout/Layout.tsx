import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TrialBanner, TrialPaywall } from "./TrialBanner";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <TrialPaywall />
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <TrialBanner />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
