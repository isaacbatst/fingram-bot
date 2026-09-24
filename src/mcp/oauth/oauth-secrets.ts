import { createHash, randomBytes } from 'node:crypto';

/** Opaque, URL-safe secret (256 bits) for codes and tokens. */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Codes and tokens are persisted only as their SHA-256. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
