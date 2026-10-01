/**
 * RFC 6238 TOTP (HMAC-SHA-1, 6 digits, 30-second steps) with node:crypto, so the suite can answer
 * the platform's two-factor prompts like a real authenticator app.
 */
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("TOTP secret is not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totp(base32Secret: string, atMs = Date.now(), stepSeconds = 30, digits = 6): string {
  return hotp(base32Decode(base32Secret), Math.floor(atMs / 1000 / stepSeconds), digits);
}

/** Milliseconds left in the current 30-second step. */
export function msLeftInStep(atMs = Date.now(), stepSeconds = 30): number {
  const stepMs = stepSeconds * 1000;
  return stepMs - (atMs % stepMs);
}

/**
 * A code that stays valid long enough to be typed and verified: when fewer than `minMs` remain in
 * the current step, waits for the next step first. `avoid` skips a code already used in this step
 * (the auth server may refuse a replayed code).
 */
export async function freshTotp(base32Secret: string, opts: { minMs?: number; avoid?: string | null } = {}) {
  const minMs = opts.minMs ?? 6000;
  for (let i = 0; i < 4; i += 1) {
    const left = msLeftInStep();
    if (left < minMs) {
      await new Promise((r) => setTimeout(r, left + 250));
      continue;
    }
    const code = totp(base32Secret);
    if (opts.avoid && code === opts.avoid) {
      await new Promise((r) => setTimeout(r, msLeftInStep() + 250));
      continue;
    }
    return code;
  }
  return totp(base32Secret);
}
