import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable, ordersTable } from "@workspace/db/schema";
import { eq, gt, desc } from "drizzle-orm";

const router = Router();

interface SSEClient {
  restaurantId: number;
  res: import("express").Response;
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

router.get("/restaurants/:restaurantId/events", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  if (isNaN(restaurantId)) {
    res.status(400).json({ error: "Invalid restaurantId" });
    return;
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
        .where(
          eq(notificationsTable.restaurantId, restaurantId)
        )
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
});

export default router;
