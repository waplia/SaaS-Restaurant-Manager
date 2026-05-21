import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import * as SecureStorage from "@/lib/secureStorage";

export type ConnectionState = "live" | "polling" | "offline";

export interface RealtimeEventHandlers {
  onNewOrder?: (payload: { kitchenId?: number | null } | undefined) => void;
  onTicketStatus?: () => void;
  onTicketDelayed?: (payload: { kitchenId?: number | null; orderNumber?: string | null } | undefined) => void;
}

/**
 * Subscribe to socket.io for KDS realtime updates. Mirrors the web
 * restaurant-platform `useSocket` channels. Falls back to React Query
 * polling when the socket cannot connect — the polling cadence is owned
 * by the calling hook (useKdsTickets), this just reports the state.
 */
export function useKdsRealtime(restaurantId: number, ticketsQueryKey: readonly unknown[], handlers: RealtimeEventHandlers = {}) {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>("polling");
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

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
      socket = io(base || undefined, {
        path: "/api/socket.io",
        auth: { token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 8,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
      });
      socketRef.current = socket;

      socket.on("connect", () => setState("live"));
      socket.on("disconnect", () => setState("polling"));
      socket.on("connect_error", () => setState("polling"));

      const invalidateTickets = () => qc.invalidateQueries({ queryKey: ticketsQueryKey });

      socket.on("order:new", (payload: { kitchenId?: number | null } | undefined) => {
        invalidateTickets();
        handlersRef.current.onNewOrder?.(payload);
      });
      socket.on("ticket:status", () => {
        invalidateTickets();
        handlersRef.current.onTicketStatus?.();
      });
      socket.on("order:status", invalidateTickets);
      socket.on("ticket:delayed", (payload: { kitchenId?: number | null; orderNumber?: string | null } | undefined) => {
        invalidateTickets();
        handlersRef.current.onTicketDelayed?.(payload);
      });
    })();

    return () => {
      cancelled = true;
      socket?.removeAllListeners();
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, qc, ticketsQueryKey]);

  return state;
}
