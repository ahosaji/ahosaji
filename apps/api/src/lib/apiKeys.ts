import { createHash, randomBytes } from 'node:crypto';

export function generateKey(): { plaintext: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const plaintext = `ahk_${raw}`;
  const prefix = plaintext.slice(0, 12);
  const hash = sha256(plaintext);
  return { plaintext, prefix, hash };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
