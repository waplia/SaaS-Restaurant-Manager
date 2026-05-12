import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable, restaurantsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../middleware/authorize";
import { verifyToken } from "../lib/auth";
import type { Request, Response, NextFunction } from "express";

const router = Router();

interface SSEClient {
  restaurantId: number;
  res: Response;
  lastEventId: number;
}

const clients = new Set<SSEClient>();

export function broadcastEvent(
  restaurantId: number,
  event: string,
  data: unknown,
  id?: number
) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.restaurantId === restaurantId) {
      if (id !== undefined) client.res.write(`id: ${id}\n`);
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${payload}\n\n`);
    }
  }
}

function authenticateSSE(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let rawToken: string | undefined;

  if (header?.startsWith("Bearer ")) {
    rawToken = header.slice(7);
  } else if (typeof req.query.token === "string") {
    rawToken = req.query.token;
  }

  if (!rawToken) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  try {
    const payload = verifyToken(rawToken);
    if (payload.type !== "access") {
      res.status(401).json({ error: "Invalid token type" });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.get(
  "/restaurants/:restaurantId/events",
  authenticateSSE,
  requireRole("owner", "manager", "waiter", "kitchen", "super_admin"),
  async (req, res) => {
    const restaurantId = Number(req.params.restaurantId);
    if (isNaN(restaurantId)) {
      res.status(400).json({ error: "Invalid restaurantId" });
      return;
    }

    if (!req.user!.isSuperAdmin) {
      const [restaurant] = await db
        .select({ tenantId: restaurantsTable.tenantId })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, restaurantId));
      if (!restaurant) {
        res.status(404).json({ error: "Restaurant not found" });
        return;
      }
      if (restaurant.tenantId !== req.user!.tenantId) {
        res.status(403).json({ error: "Access denied: cross-tenant request" });
        return;
      }
      if (req.user!.restaurantId && req.user!.restaurantId !== restaurantId) {
        res.status(403).json({ error: "Access denied: restaurant mismatch" });
        return;
      }
    }

    const lastEventIdHeader = req.headers["last-event-id"];
    const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : 0;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const client: SSEClient = { restaurantId, res, lastEventId };
    clients.add(client);

    res.write(": connected\n\n");

    try {
      if (lastEventId > 0) {
        const missed = await db
          .select()
          .from(notificationsTable)
          .where(eq(notificationsTable.restaurantId, restaurantId))
          .orderBy(desc(notificationsTable.createdAt))
          .limit(20);

        for (const n of missed.reverse()) {
          res.write(`id: ${n.id}\n`);
          res.write(`event: new_notification\n`);
          res.write(`data: ${JSON.stringify(n)}\n\n`);
        }
      }
    } catch {
      // non-fatal — stream continues
    }

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
  }
);

export default router;
