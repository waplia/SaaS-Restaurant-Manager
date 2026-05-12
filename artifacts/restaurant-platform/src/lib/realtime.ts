import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function useSocket(restaurantId: number) {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    const token = localStorage.getItem("tt_access_token");
    if (!token) return;

    const socket = io(API_BASE, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    socketRef.current = socket;

    socket.on("order:new", () => {
      void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
    });

    socket.on("order:status", () => {
      void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["tables", restaurantId] });
    });

    socket.on("ticket:status", () => {
      void qc.invalidateQueries({ queryKey: ["kitchen", "tickets", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, qc]);
}
