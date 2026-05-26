import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { playNewOrderChime, playNotificationChime } from "./notificationSound";

const API_BASE = "";

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
      playNewOrderChime();
      void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "staff-activity", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["reports", restaurantId] });
    });

    socket.on("order:status", () => {
      void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "revenue-trend", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "popular-items", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "staff-activity", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["reports", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["tables", restaurantId] });
    });

    socket.on("ticket:status", () => {
      void qc.invalidateQueries({ queryKey: ["kitchen", "tickets", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "live-kitchen", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "summary", restaurantId] });
    });

    socket.on("notification:new", () => {
      playNotificationChime();
      void qc.invalidateQueries({ queryKey: ["notifications", restaurantId] });
    });

    // Guest verification hold — new held order, accept, reject, re-ping,
    // escalation. All five refresh the guest-verifications query so the
    // Tables glow, Requests section and Orders banner stay in sync.
    const refreshGuestVerifications = () => {
      void qc.invalidateQueries({ queryKey: ["guest-verifications", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["tables", restaurantId] });
    };
    socket.on("guest_verification:new", () => {
      playNotificationChime();
      refreshGuestVerifications();
    });
    socket.on("guest_verification:accepted", refreshGuestVerifications);
    socket.on("guest_verification:rejected", refreshGuestVerifications);
    socket.on("guest_verification:reping", () => {
      playNotificationChime();
      refreshGuestVerifications();
    });
    socket.on("guest_verification:escalated", () => {
      playNotificationChime();
      refreshGuestVerifications();
    });

    socket.on("waiter_request:new", () => {
      playNotificationChime();
      void qc.invalidateQueries({ queryKey: ["waiter-requests", restaurantId] });
    });

    socket.on("waiter_request:update", () => {
      void qc.invalidateQueries({ queryKey: ["waiter-requests", restaurantId] });
    });

    // Operations Intelligence realtime channels.
    socket.on("ops_approval:new", () => {
      void qc.invalidateQueries({ queryKey: ["ops", "approvals"] });
    });
    socket.on("ops_approval:updated", () => {
      void qc.invalidateQueries({ queryKey: ["ops", "approvals"] });
    });
    socket.on("panic:raised", () => {
      playNotificationChime();
      void qc.invalidateQueries({ queryKey: ["ops", "panic"] });
      void qc.invalidateQueries({ queryKey: ["ops", "digital-twin", restaurantId] });
    });
    socket.on("panic:updated", () => {
      void qc.invalidateQueries({ queryKey: ["ops", "panic"] });
      void qc.invalidateQueries({ queryKey: ["ops", "digital-twin", restaurantId] });
    });
    socket.on("service_timer:event", () => {
      void qc.invalidateQueries({ queryKey: ["ops", "digital-twin", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["ops", "timeline", restaurantId] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, qc]);
}
