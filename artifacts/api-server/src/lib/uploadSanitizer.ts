import sharp from "sharp";
import type { File } from "@google-cloud/storage";

/**
 * Re-encodes uploaded images and validates non-image uploads by their real
 * magic bytes rather than the client-supplied Content-Type. This closes the
 * gap where a bad actor could upload an HTML/JS payload labelled `image/png`.
 *
 * For image uploads, sharp re-encodes the pixels which:
 *   - strips EXIF / GPS / ICC profile metadata
 *   - drops any embedded thumbnails or hidden payloads
 *   - normalises orientation
 *   - guarantees the stored bytes are a well-formed image
 *
 * For non-image kinds (pdf, video) we cannot re-encode, but we still verify
 * the magic bytes and overwrite the stored Content-Type with the sniffed one.
 */

export type AllowedKind = "image" | "pdf" | "video";

export interface SniffResult {
  mime: string;
  kind: AllowedKind;
}

/**
 * Per-kind allowlist of client-declared Content-Type values. We accept this set
 * at the presigned-URL request step so a caller who lies about their type is
 * rejected BEFORE they get to push bytes to object storage. The final source
 * of truth is still magic-byte sniffing in `sanitizeStoredUpload`.
 */
export const CONTENT_TYPE_BY_KIND: Record<AllowedKind, readonly string[]> = {
  image: [
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/bmp",
    "image/tiff",
    "image/x-tiff",
  ],
  pdf: ["application/pdf", "application/x-pdf"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};

function normalizeContentType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0].trim();
}

export function isContentTypeAllowed(
  contentType: string,
  kinds: ReadonlyArray<AllowedKind>,
): boolean {
  const ct = normalizeContentType(contentType);
  return kinds.some((k) => CONTENT_TYPE_BY_KIND[k].includes(ct));
}

/**
 * Throws an UploadValidationError(415) if `contentType` is not in the
 * allowlist for any of the given `kinds`. Use this at the presigned-URL
 * request step so unsafe types never make it to object storage.
 */
export function assertAllowedContentType(
  contentType: string,
  kinds: ReadonlyArray<AllowedKind>,
): void {
  if (!isContentTypeAllowed(contentType, kinds)) {
    const allowed = Array.from(new Set(kinds.flatMap((k) => CONTENT_TYPE_BY_KIND[k]))).join(", ");
    throw new UploadValidationError(
      `File type "${contentType}" is not allowed. Allowed types: ${allowed}.`,
      415,
    );
  }
}

const MAGIC_SIGNATURES: ReadonlyArray<{
  mime: string;
  kind: AllowedKind;
  match: (b: Buffer) => boolean;
}> = [
  { mime: "image/jpeg", kind: "image", match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png",  kind: "image", match: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: "image/gif",  kind: "image", match: (b) => b.length >= 6 && b.slice(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null },
  { mime: "image/webp", kind: "image", match: (b) => b.length >= 12 && b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP" },
  { mime: "image/heic", kind: "image", match: (b) => b.length >= 12 && b.slice(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(b.slice(8, 12).toString("ascii")) },
  { mime: "image/bmp",  kind: "image", match: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d },
  { mime: "image/tiff", kind: "image", match: (b) => b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) },
  { mime: "application/pdf", kind: "pdf", match: (b) => b.length >= 5 && b.slice(0, 5).toString("ascii") === "%PDF-" },
  { mime: "video/mp4",  kind: "video", match: (b) => b.length >= 12 && b.slice(4, 8).toString("ascii") === "ftyp" },
  { mime: "video/webm", kind: "video", match: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: "video/quicktime", kind: "video", match: (b) => b.length >= 12 && b.slice(4, 8).toString("ascii") === "moov" },
];

export function sniffBytes(bytes: Buffer): SniffResult | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.match(bytes)) return { mime: sig.mime, kind: sig.kind };
  }
  return null;
}

export class UploadValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "UploadValidationError";
    this.statusCode = statusCode;
  }
}

export interface SanitizeOptions {
  allowedKinds: ReadonlyArray<AllowedKind>;
  maxBytes: number;
  /** Cap re-encoded image dimensions (defense against decompression bombs). */
  maxImagePixels?: number;
  /**
   * For objects whose stored size exceeds this threshold, sniff only the first
   * few KB (via byte-range read) before pulling down the full object. Lets us
   * reject a 500 MB HTML payload labelled `video/mp4` after a 4 KB read.
   * Defaults to 1 MiB.
   */
  partialSniffThresholdBytes?: number;
}

export interface SanitizeResult {
  mime: string;
  kind: AllowedKind;
  size: number;
}

async function downloadBuffer(file: File): Promise<Buffer> {
  const [buf] = await file.download();
  return buf;
}

async function downloadRange(file: File, start: number, end: number): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = file.createReadStream({ start, end });
    stream.on("data", (chunk: string | Buffer) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function getStoredSize(file: File): Promise<number | null> {
  try {
    const [meta] = await file.getMetadata();
    if (meta.size == null) return null;
    const n = Number(meta.size);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Inspect, validate, and (for images) re-encode the bytes of an already-uploaded
 * object. On failure the underlying object is deleted and an UploadValidationError
 * is thrown. On success the stored object's Content-Type metadata is updated to
 * match the sniffed type so downstream serving cannot honour a client lie.
 */
export async function sanitizeStoredUpload(
  file: File,
  opts: SanitizeOptions,
): Promise<SanitizeResult> {
  const maxBytes = opts.maxBytes;
  const maxPixels = opts.maxImagePixels ?? 24_000_000; // ~24 MP — enough for 6000×4000.
  const partialThreshold = opts.partialSniffThresholdBytes ?? 1024 * 1024;

  // Cheap pre-checks against the stored object's metadata first so we can fail
  // fast on oversize or obviously-wrong-typed payloads BEFORE downloading the
  // whole object back over the wire.
  const storedSize = await getStoredSize(file);
  if (storedSize != null) {
    if (storedSize === 0) {
      await file.delete().catch(() => undefined);
      throw new UploadValidationError("Uploaded file is empty", 400);
    }
    if (storedSize > maxBytes) {
      await file.delete().catch(() => undefined);
      throw new UploadValidationError(`File too large. Max ${maxBytes} bytes.`, 413);
    }
    if (storedSize > partialThreshold) {
      let head: Buffer;
      try {
        head = await downloadRange(file, 0, Math.min(4095, storedSize - 1));
      } catch {
        throw new UploadValidationError("Failed to read uploaded bytes", 500);
      }
      const headSniff = sniffBytes(head);
      if (!headSniff || !opts.allowedKinds.includes(headSniff.kind)) {
        await file.delete().catch(() => undefined);
        throw new UploadValidationError(
          `Unsupported or unrecognised file type. Allowed: ${opts.allowedKinds.join(", ")}.`,
          415,
        );
      }
    }
  }

  let bytes: Buffer;
  try {
    bytes = await downloadBuffer(file);
  } catch {
    throw new UploadValidationError("Failed to read uploaded bytes", 500);
  }

  if (bytes.length === 0) {
    await file.delete().catch(() => undefined);
    throw new UploadValidationError("Uploaded file is empty", 400);
  }
  if (bytes.length > maxBytes) {
    await file.delete().catch(() => undefined);
    throw new UploadValidationError(`File too large. Max ${maxBytes} bytes.`, 413);
  }

  const sniffed = sniffBytes(bytes);
  if (!sniffed || !opts.allowedKinds.includes(sniffed.kind)) {
    await file.delete().catch(() => undefined);
    throw new UploadValidationError(
      `Unsupported or unrecognised file type. Allowed: ${opts.allowedKinds.join(", ")}.`,
      415,
    );
  }

  if (sniffed.kind === "image") {
    let pipeline = sharp(bytes, { failOn: "error", limitInputPixels: maxPixels })
      .rotate() // auto-orient from EXIF, then strip metadata below
      .withMetadata({ orientation: undefined, exif: {}, icc: undefined });

    // Re-encode to a canonical format per source. Animated GIFs are preserved
    // as GIF; everything else collapses to JPEG/PNG/WebP losslessly enough.
    let outMime: string;
    if (sniffed.mime === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
      outMime = "image/png";
    } else if (sniffed.mime === "image/gif") {
      // sharp keeps frames if `animated:true` set on input; we already loaded.
      pipeline = sharp(bytes, { animated: true, limitInputPixels: maxPixels })
        .rotate()
        .withMetadata({ orientation: undefined, exif: {}, icc: undefined })
        .gif();
      outMime = "image/gif";
    } else if (sniffed.mime === "image/webp") {
      pipeline = pipeline.webp({ quality: 88 });
      outMime = "image/webp";
    } else {
      // JPEG, HEIC, BMP, TIFF → JPEG (broadest browser support, drops EXIF).
      pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
      outMime = "image/jpeg";
    }

    let encoded: Buffer;
    try {
      encoded = await pipeline.toBuffer();
    } catch {
      await file.delete().catch(() => undefined);
      throw new UploadValidationError("Image failed safety re-encoding", 415);
    }

    if (encoded.length > maxBytes) {
      await file.delete().catch(() => undefined);
      throw new UploadValidationError(`Re-encoded file too large. Max ${maxBytes} bytes.`, 413);
    }

    try {
      await file.save(encoded, {
        resumable: false,
        contentType: outMime,
        metadata: { contentType: outMime, cacheControl: "private, max-age=3600" },
      });
    } catch {
      throw new UploadValidationError("Failed to persist sanitized image", 500);
    }
    return { mime: outMime, kind: "image", size: encoded.length };
  }

  // Non-image: lock the stored Content-Type to the sniffed one so the server
  // never serves a PDF/video back with a client-supplied mime lie. Fail
  // closed — if we can't pin the content-type, the hardening goal isn't met,
  // so delete the object and surface the error rather than letting it serve
  // with the client-supplied mime.
  try {
    await file.setMetadata({ contentType: sniffed.mime });
  } catch (err) {
    await file.delete().catch(() => undefined);
    throw new UploadValidationError(
      `Failed to lock stored content-type for sanitized upload: ${(err as Error).message}`,
      500,
    );
  }
  return { mime: sniffed.mime, kind: sniffed.kind, size: bytes.length };
}
