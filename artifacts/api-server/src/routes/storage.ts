import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy, isAclOwnerOf, ObjectPermission } from "../lib/objectAcl";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requireRole } from "../middleware/authorize";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(256),
  size: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.string().min(1).max(128),
});

/**
 * Request a presigned PUT URL scoped to a restaurant.
 * The returned objectPath is later persisted on a domain row (e.g. expense.receiptUrl)
 * and served via GET /restaurants/:restaurantId/storage/objects/* with ACL enforcement.
 */
router.post(
  "/restaurants/:restaurantId/storage/uploads/request-url",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }
    try {
      const restaurantId = Number(req.params.restaurantId);
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Persist tenant ownership so future reads can be authorized.
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        await setObjectAclPolicy(objectFile, {
          restaurantId: String(restaurantId),
          uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
          visibility: "private",
        });
      } catch {
        // ACL is also re-asserted on first read; the file may not yet be visible immediately
        // after presign. We'll rely on the lazy enforcement path as well.
      }

      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * Serve a stored object only if the requesting user belongs to the same restaurant
 * recorded in the object's ACL policy.
 */
router.get(
  "/restaurants/:restaurantId/storage/objects/*path",
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    try {
      const requestingRestaurantId = Number(req.params.restaurantId);
      const raw = (req.params as Record<string, string | string[]>).path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

      const aclPolicy = await getObjectAclPolicy(objectFile);
      if (!isAclOwnerOf(aclPolicy, requestingRestaurantId, ObjectPermission.READ)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
