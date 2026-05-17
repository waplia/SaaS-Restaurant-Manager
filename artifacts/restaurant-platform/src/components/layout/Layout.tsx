import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { TrialBanner, TrialPaywall } from "./TrialBanner";
import { OnboardingBanner } from "./OnboardingBanner";
import { AiChatAssistant } from "@/components/ai/AiChatAssistant";
import { OfflineBadge } from "@/components/OfflineBadge";
import { useOfflineSyncEngine } from "@/lib/useOnlineStatus";
import { useAuth } from "@/lib/auth";

const STAFF_ROLES = new Set(["cashier", "waiter", "kitchen", "delivery_executive", "counter_staff", "staff"]);

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isStaff = !!user && !user.isSuperAdmin && !!user.role && STAFF_ROLES.has(user.role);
  useOfflineSyncEngine();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <TrialPaywall />
      {/* Sidebar hidden on mobile for staff (replaced by bottom nav + drawer) */}
      <div className={isStaff ? "hidden md:flex" : "flex"}>
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <TrialBanner />
        <OnboardingBanner />
        <div className="fixed top-2 right-3 z-50">
          <OfflineBadge />
        </div>
        <main className={`flex-1 min-h-0 flex flex-col overflow-auto ${isStaff ? "pb-16 md:pb-0" : ""}`}>{children}</main>
      </div>
      <AiChatAssistant />
      <BottomNav />
    </div>
  );
}
