import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyToken } from "./auth";

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
    if (!token) return next(new Error("Missing token"));
    try {
      const payload = verifyToken(token);
      if (payload.type !== "access") return next(new Error("Invalid token type"));
      (socket as unknown as Record<string, unknown>).user = payload;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as unknown as Record<string, unknown>).user as { restaurantId?: number; tenantId?: number; isSuperAdmin?: boolean };
    const restaurantId = user?.restaurantId;
    if (restaurantId) {
      void socket.join(`restaurant:${restaurantId}`);
    }
  });

  return io;
}

export function broadcastEvent(restaurantId: number, event: string, data: unknown): void {
  if (!io) return;
  io.to(`restaurant:${restaurantId}`).emit(event, data);
}
