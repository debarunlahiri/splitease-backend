import { createHash, randomBytes } from 'node:crypto';

/** A random 256-bit token, URL-safe base64 without padding (43 characters). */
export function generateToken(): string {
    return randomBytes(32).toString('base64url');
}

/** Only this hash of a token is ever stored. */
export function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
