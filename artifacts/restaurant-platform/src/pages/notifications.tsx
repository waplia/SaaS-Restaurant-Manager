import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useNotifications } from "@/lib/hooks";
import { Bell, AlertTriangle, ChefHat, Phone, Calendar, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/lib/types";

const TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  new_order: { icon: ChefHat, color: "bg-blue-100 text-blue-600" },
  low_stock: { icon: AlertTriangle, color: "bg-red-100 text-red-600" },
  waiter_request: { icon: Phone, color: "bg-orange-100 text-orange-600" },
  waiter_call: { icon: Phone, color: "bg-orange-100 text-orange-600" },
  reservation: { icon: Calendar, color: "bg-purple-100 text-purple-600" },
  payment: { icon: Info, color: "bg-green-100 text-green-600" },
  system: { icon: Bell, color: "bg-gray-100 text-gray-600" },
};

export default function NotificationsPage() {
  const { data: notifications = [] } = useNotifications();

  return (
    <Layout>
      <PageHeader title="Notifications" subtitle={`${notifications.filter((n: AppNotification) => !n.isRead).length} unread`} />
      <div className="p-6 max-w-2xl">
        <div className="space-y-3">
          {notifications.map((n: AppNotification) => {
            const isUrgent = n.type === "admin.broadcast.urgent";
            if (isUrgent) {
              return (
                <div key={n.id}
                  className={cn("flex gap-4 p-4 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 shadow-sm")}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-600 text-white">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <p className="font-bold text-red-700 dark:text-red-300 text-sm">🚨 {n.title}</p>
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0 mt-1.5" />}
                    </div>
                    <p className="text-sm text-red-800 dark:text-red-200 mt-0.5 whitespace-pre-line">{n.message}</p>
                    <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })} · Urgent admin broadcast
                    </p>
                  </div>
                </div>
              );
            }
            const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
            const Icon = cfg.icon;
            return (
              <div key={n.id} className={cn("flex gap-4 p-4 rounded-xl border", !n.isRead ? "bg-accent/30 border-primary/20" : "bg-card border-border")}>
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", cfg.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <p className="font-medium text-foreground text-sm">{n.title}</p>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                </div>
              </div>
            );
          })}
          {notifications.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No notifications</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
