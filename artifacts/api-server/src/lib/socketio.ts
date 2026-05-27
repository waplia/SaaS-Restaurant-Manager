import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyToken } from "./auth";
import { validateGuestToken } from "./guestToken";
import { sendWebPushToOrder } from "./webPush";
import { formatOrderNumber } from "./orderNumber";

interface SocketUser {
  restaurantId?: number;
  tenantId?: number;
  isSuperAdmin?: boolean;
}

declare module "socket.io" {
  interface SocketData {
    user?: SocketUser;
    isGuest?: boolean;
  }
}

let io: Server | null = null;

export function initSocketIO(httpServer: HTTPServer): Server {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : true;

  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
    path: "/api/socket.io",
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
      ?? socket.handshake.query?.token as string | undefined;
    if (!token) {
      socket.data.isGuest = true;
      socket.data.user = undefined;
      return next();
    }
    try {
      const payload = verifyToken(token);
      if (payload.type !== "access") return next(new Error("Invalid token type"));
      socket.data.isGuest = false;
      socket.data.user = {
        restaurantId: payload.restaurantId,
        tenantId: payload.tenantId,
        isSuperAdmin: payload.isSuperAdmin,
      };
      next();
    } catch {
      socket.data.isGuest = true;
      socket.data.user = undefined;
      next();
    }
  });

  io.on("connection", (socket) => {
    const restaurantId = socket.data.user?.restaurantId;
    if (restaurantId) {
      void socket.join(`restaurant:${restaurantId}`);
    }

    socket.on("join:order", (data: unknown) => {
      let orderId: number | undefined;
      let token: string | undefined;
      if (typeof data === "object" && data !== null && "orderId" in data) {
        orderId = Number((data as { orderId: unknown }).orderId);
        token = String((data as { token?: unknown }).token ?? "");
      } else if (typeof data === "number") {
        orderId = data;
      }
      if (!orderId || orderId <= 0) return;
      if (!socket.data.isGuest) return;
      if (!validateGuestToken(orderId, token)) return;
      void socket.join(`order:${orderId}`);
    });

    socket.on("leave:order", (data: unknown) => {
      const orderId = typeof data === "number" ? data : typeof data === "object" && data !== null && "orderId" in data ? Number((data as { orderId: unknown }).orderId) : 0;
      if (orderId > 0) void socket.leave(`order:${orderId}`);
    });

    // Public token display board: guests join a per-outlet room. No auth
    // is required — the room only carries already-projected (masked) token
    // payloads safe for public display.
    socket.on("join:tokens", (data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      const restaurantId = Number((data as { restaurantId?: unknown }).restaurantId);
      const branchId = (data as { branchId?: unknown }).branchId;
      if (!restaurantId || restaurantId <= 0) return;
      if (branchId == null || branchId === "all") {
        void socket.join(`tokens:${restaurantId}:all`);
      } else {
        const b = Number(branchId);
        if (b > 0) void socket.join(`tokens:${restaurantId}:${b}`);
      }
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

export function broadcastEvent(restaurantId: number, event: string, data: unknown): void {
  if (!io) return;
  io.to(`restaurant:${restaurantId}`).emit(event, data);
}

export function broadcastOrderUpdate(orderId: number, data: unknown): void {
  if (io) io.to(`order:${orderId}`).emit("order:update", data);

  // Best-effort browser Web Push for diners whose tab is closed or backgrounded.
  // Only fires for guest-facing status transitions; silent for everything else.
  if (typeof data === "object" && data !== null) {
    const d = data as { status?: unknown; orderNumber?: unknown };
    const status = typeof d.status === "string" ? d.status : null;
    const orderNumber = typeof d.orderNumber === "string" ? d.orderNumber : null;
    const titleByStatus: Record<string, string> = {
      confirmed: "Order confirmed",
      preparing: "Your order is being prepared",
      ready: "Your order is ready!",
      served: "Your order has been served",
      completed: "Order completed",
      cancelled: "Order cancelled",
    };
    if (status && titleByStatus[status]) {
      const title = titleByStatus[status];
      const body = orderNumber ? `Order ${formatOrderNumber(orderNumber)}: ${status}` : `Status: ${status}`;
      void sendWebPushToOrder(orderId, { title, body, data: { orderId, status } });
    }
  }
}
