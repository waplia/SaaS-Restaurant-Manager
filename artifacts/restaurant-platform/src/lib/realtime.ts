import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function useSSE(restaurantId: number) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 8;

  useEffect(() => {
    if (!restaurantId) return;

    const token = localStorage.getItem("tt_access_token");
    if (!token) return;

    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const url = `${BASE_URL}/api/restaurants/${restaurantId}/events?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("order:new", () => {
        void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
      });

      es.addEventListener("order:status", () => {
        void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["tables", restaurantId] });
      });

      es.addEventListener("ticket:status", () => {
        void qc.invalidateQueries({ queryKey: ["kitchen", "tickets", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
        void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
      });

      es.onopen = () => {
        retriesRef.current = 0;
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!unmounted && retriesRef.current < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
          retriesRef.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [restaurantId, qc]);
}
