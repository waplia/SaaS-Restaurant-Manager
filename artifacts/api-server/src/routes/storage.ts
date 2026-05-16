import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy, isAclOwnerOf, ObjectPermission } from "../lib/objectAcl";
import { sanitizeStoredUpload, UploadValidationError } from "../lib/uploadSanitizer";
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
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      // Note: ACL is written by the matching POST /finalize call AFTER the
      // client successfully PUTs the object. Pre-PUT setMetadata would fail
      // because the object does not yet exist.
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

const FinalizeUploadBody = z.object({
  objectPath: z.string().min(1),
});

/**
 * Called by the client AFTER a successful PUT to the presigned URL. Writes
 * the tenant-scoped ACL policy onto the now-existing object. Without this
 * step, the read endpoint will refuse to serve the object (403).
 */
router.post(
  "/restaurants/:restaurantId/storage/uploads/finalize",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const parsed = FinalizeUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "objectPath required" });
      return;
    }
    const { objectPath } = parsed.data;
    if (!objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid objectPath" });
      return;
    }
    try {
      const restaurantId = Number(req.params.restaurantId);
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const existing = await getObjectAclPolicy(objectFile);
      if (existing && existing.restaurantId !== String(restaurantId)) {
        // Object already claimed by another tenant — refuse to overwrite.
        res.status(403).json({ error: "Object already owned by another tenant" });
        return;
      }
      try {
        await sanitizeStoredUpload(objectFile, {
          allowedKinds: ["image", "pdf"],
          maxBytes: 10 * 1024 * 1024,
        });
      } catch (sanErr) {
        if (sanErr instanceof UploadValidationError) {
          res.status(sanErr.statusCode).json({ error: sanErr.message });
          return;
        }
        throw sanErr;
      }
      await setObjectAclPolicy(objectFile, {
        restaurantId: String(restaurantId),
        uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
        visibility: "private",
      });
      res.json({ ok: true, objectPath });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found — upload may not have completed" });
        return;
      }
      req.log.error({ err: error }, "Error finalizing upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

/**
 * Finalize an upload as PUBLIC. Used for assets that need to be served on the
 * customer-facing menu (menu banners, category thumbnails, item photos).
 */
router.post(
  "/restaurants/:restaurantId/storage/uploads/finalize-public",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
  async (req: Request, res: Response) => {
    const parsed = FinalizeUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "objectPath required" });
      return;
    }
    const { objectPath } = parsed.data;
    if (!objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid objectPath" });
      return;
    }
    try {
      const restaurantId = Number(req.params.restaurantId);
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const existing = await getObjectAclPolicy(objectFile);
      if (existing && existing.restaurantId !== String(restaurantId)) {
        res.status(403).json({ error: "Object already owned by another tenant" });
        return;
      }
      try {
        await sanitizeStoredUpload(objectFile, {
          allowedKinds: ["image"],
          maxBytes: 10 * 1024 * 1024,
        });
      } catch (sanErr) {
        if (sanErr instanceof UploadValidationError) {
          res.status(sanErr.statusCode).json({ error: sanErr.message });
          return;
        }
        throw sanErr;
      }
      await setObjectAclPolicy(objectFile, {
        restaurantId: String(restaurantId),
        uploaderId: req.user?.sub ? String(req.user.sub) : undefined,
        visibility: "public",
      });
      res.json({ ok: true, objectPath });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found — upload may not have completed" });
        return;
      }
      req.log.error({ err: error }, "Error finalizing public upload");
      res.status(500).json({ error: "Failed to finalize upload" });
    }
  },
);

/**
 * Public read endpoint for objects whose ACL marks them visibility=public.
 * Mounted under /api (no auth) so customer-facing pages can render menu images.
 */
export const publicStorageRouter: IRouter = Router();
publicStorageRouter.get("/public/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = (req.params as Record<string, string | string[]>).path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const aclPolicy = await getObjectAclPolicy(objectFile);
    if (!aclPolicy || aclPolicy.visibility !== "public") {
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
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

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
