import { Link } from "wouter";
import { CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useOnlineStatus, useOfflineQueue } from "@/lib/useOnlineStatus";

/**
 * Compact pill rendered in the header. Shows:
 *  - red "Offline" pill when the browser reports offline
 *  - orange "Syncing N" pill while there are pending/failed entries
 *  - red "N conflict" pill when the server rejected queued items
 * Clicking the pill jumps to /pos-sync for the full status board.
 */
export function OfflineBadge() {
  const { online } = useOnlineStatus();
  const entries = useOfflineQueue();
  const pending = entries.filter(e => e.status === "pending" || e.status === "failed" || e.status === "syncing").length;
  const conflicts = entries.filter(e => e.status === "conflict").length;

  if (online && pending === 0 && conflicts === 0) return null;

  return (
    <Link href="/pos-sync">
      <div className="flex items-center gap-1.5 cursor-pointer">
        {!online && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
            <CloudOff className="w-3 h-3" /> Offline
          </span>
        )}
        {pending > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
            <RefreshCw className="w-3 h-3 animate-spin" /> Syncing {pending}
          </span>
        )}
        {conflicts > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
            <AlertTriangle className="w-3 h-3" /> {conflicts} conflict{conflicts !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </Link>
  );
}
