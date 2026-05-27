import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { getListFloorTablesQueryKey } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import * as SecureStorage from "@/lib/secureStorage";

export type ConnectionState = "live" | "polling" | "offline";

/**
 * Waiter-side socket subscription.
 *
 * The waiter's Ready queue and running-order screens need to flip the
 * moment the kitchen marks a single item (or full KOT) ready — otherwise
 * partial-ready rounds only surface after the 20s React Query poll,
 * which the floor reads as "Ready only shows when EVERYTHING is ready".
 *
 * Listens to the two channels the API broadcasts on kitchen transitions
 * (`ticket:status`, `order:item-status`) and invalidates the running-order
 * + floor-table queries so the UI re-fetches immediately. Falls back to
 * the existing polling cadence when the socket can't connect.
 */
export function useWaiterRealtime(restaurantId: number) {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>("polling");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      const token = await SecureStorage.getItem("accessToken").catch(() => null);
      if (cancelled || !token) {
        setState("offline");
        return;
      }
      const base = getApiBaseUrl();
      const s = io(base || undefined, {
        path: "/api/socket.io",
        auth: { token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 8,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
      });
      // Guard against unmount happening between the async token fetch and
      // socket construction: drop the freshly-created socket instead of
      // leaking listeners/connections.
      if (cancelled) {
        s.removeAllListeners();
        s.disconnect();
        return;
      }
      socket = s;
      socketRef.current = s;

      s.on("connect", () => setState("live"));
      s.on("disconnect", () => setState("polling"));
      s.on("connect_error", () => setState("polling"));

      const invalidateFloor = () => {
        // running-order summaries power the Ready queue grouping;
        // orders + canonical floor-tables key drive the table list/map.
        qc.invalidateQueries({ queryKey: ["running-order"] });
        qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
        qc.invalidateQueries({ queryKey: getListFloorTablesQueryKey(restaurantId) });
      };

      // Kitchen marks a whole KOT through preparing/ready/served.
      s.on("ticket:status", invalidateFloor);
      // Per-item kitchen-status transitions (chef cycles or owner KDS).
      s.on("order:item-status", invalidateFloor);
      // New rounds added or order header changes.
      s.on("order:new", invalidateFloor);
      s.on("order:updated", invalidateFloor);
      s.on("order:status", invalidateFloor);
    })();

    return () => {
      cancelled = true;
      socket?.removeAllListeners();
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, qc]);

  return state;
}
