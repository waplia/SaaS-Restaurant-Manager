import crypto from "crypto";
import { logger } from "./logger";

const ALGO = "aes-256-gcm";
let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env["AI_PROVIDER_KEY_ENCRYPTION_KEY"]
    ?? process.env["SESSION_SECRET"]
    ?? process.env["JWT_SECRET"];
  if (!raw || raw.length < 16) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error(
        "AI_PROVIDER_KEY_ENCRYPTION_KEY (or SESSION_SECRET/JWT_SECRET) of >= 16 chars is required in production to encrypt AI provider keys.",
      );
    }
    logger.warn("AI provider key encryption is using a development fallback seed — DO NOT use this in production. Set AI_PROVIDER_KEY_ENCRYPTION_KEY.");
  }
  const seed = raw && raw.length >= 16 ? raw : "ai-provider-key-dev-only-fallback-not-secure-32b";
  cachedKey = crypto.createHash("sha256").update(seed).digest();
  return cachedKey;
}

export interface EncryptedSecret {
  cipher: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decryptSecret(secret: { cipher: string | null; iv: string | null; tag: string | null }): string | null {
  if (!secret.cipher || !secret.iv || !secret.tag) return null;
  try {
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(secret.iv, "base64"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(secret.cipher, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch (err) {
    logger.error({ err }, "decryptSecret failed");
    return null;
  }
}

export function maskSecret(plaintext: string): string {
  if (!plaintext) return "";
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-4);
  return `${head}…${tail}`;
}
