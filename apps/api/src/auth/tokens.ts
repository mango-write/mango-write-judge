import { createHash, randomBytes, randomUUID } from "node:crypto";

/** 邀请/会话 token：32 字节随机 opaque 值，库中只存 SHA-256 哈希。 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateId(): string {
  return randomUUID();
}
