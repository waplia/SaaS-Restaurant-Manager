import { useRef, useEffect, useState } from "react";
import { Bell, CheckCheck, ExternalLink, Info, AlertTriangle, ShoppingCart, Package, Users, ChefHat } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useNotifications, useMarkAllNotificationsRead } from "@/lib/hooks";
import type { AppNotification } from "@/lib/types";

const typeIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  low_stock: Package,
  new_order: ShoppingCart,
  order_status: ChefHat,
  reservation: Users,
  info: Info,
  alert: AlertTriangle,
};

function NotifIcon({ type }: { type: string }) {
  const Icon = typeIcon[type] ?? Info;
  const colors: Record<string, string> = {
    low_stock: "text-orange-500 bg-orange-50 dark:bg-orange-950/40",
    new_order: "text-blue-500 bg-blue-50 dark:bg-blue-950/40",
    order_status: "text-green-500 bg-green-50 dark:bg-green-950/40",
    reservation: "text-purple-500 bg-purple-50 dark:bg-purple-950/40",
    alert: "text-red-500 bg-red-50 dark:bg-red-950/40",
  };
  const cls = colors[type] ?? "text-muted-foreground bg-accent";
  return (
    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", cls)}>
      <Icon className="w-4 h-4" />
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: notifications } = useNotifications();
  const markAll = useMarkAllNotificationsRead();

  const all = Array.isArray(notifications) ? notifications as AppNotification[] : [];
  const recent = all.slice(0, 6);
  const unread = all.filter(n => !n.isRead).length;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all w-full",
          open && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">Notifications</span>
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden w-80 max-h-[420px] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="font-semibold text-sm text-foreground">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              recent.map(n => (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b border-border/50 last:border-0 transition-colors",
                    !n.isRead && "bg-primary/5",
                  )}
                >
                  <NotifIcon type={n.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm leading-snug truncate", !n.isRead ? "font-semibold text-foreground" : "text-foreground")}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
