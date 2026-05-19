import { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AdminSidebar, AdminMobileBar } from "./AdminSidebar";

interface Props {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AdminLayout({ children, title, subtitle, actions }: Props) {
  const { user } = useAuth();

  if (!user?.isSuperAdmin) {
    // Friendly empty state for non-super-admins who land on a platform-only
    // page (typically via a bookmark or stale link). Pairs with the
    // `SuperAdminRoute` wrapper in App.tsx, which already redirects most
    // users away — this is the fallback for the rare case the page renders
    // before the redirect, so they see a clear "Not available" state
    // instead of submitting a form and getting a 403 "Super admin access
    // required" toast.
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm px-6">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Not available on your account</h2>
          <p className="text-muted-foreground text-sm">
            This screen is part of platform-wide administration and isn't
            available to restaurant accounts. If you think you should have
            access, please contact your platform administrator.
          </p>
          <Button variant="outline" onClick={() => window.history.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:flex">
        <AdminSidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <AdminMobileBar />
        {(title || actions) && (
          <header className="border-b border-border bg-card px-6 py-4 flex items-start justify-between gap-4 sticky top-0 z-20">
            <div className="min-w-0">
              {title && <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>}
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
          </header>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
