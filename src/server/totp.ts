import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateBase32Secret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function generateTotpCode(secretBase32: string, stepOffset = 0, stepSeconds = 30): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  const targetBuf = Buffer.from(normalized, 'utf8');
  for (let offset = -window; offset <= window; offset++) {
    const candidate = generateTotpCode(secretBase32, offset);
    const candBuf = Buffer.from(candidate, 'utf8');
    if (candBuf.length === targetBuf.length && crypto.timingSafeEqual(candBuf, targetBuf)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(email: string, secretBase32: string, issuer = 'ORBIT'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secretBase32)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
  const secret = process.env.SESSION_SECRET || 'orbit-dev-fallback-secret-key';
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

const CHALLENGE_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');

function getChallengeSecret(): string {
  return process.env.SESSION_SECRET || CHALLENGE_FALLBACK_KEY;
}

export function createTwoFactorChallengeToken(userId: string): string {
  const exp = Date.now() + 5 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', getChallengeSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyTwoFactorChallengeToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getChallengeSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: string;
      exp?: number;
    };
    if (!decoded.userId || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded.userId;
  } catch {
    return null;
  }
}
