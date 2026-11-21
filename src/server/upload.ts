import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import multer from 'multer';
import { isUserNitroActive } from './gamification.ts';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/zip',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.ogg',
  '.m4a',
  '.aac',
  '.wav',
  '.pdf',
  '.txt',
  '.md',
  '.json',
  '.zip',
]);

export function getUploadDir(): string {
  const configured = process.env.UPLOAD_DIR || 'uploads';
  const dir = path.resolve(process.cwd(), configured);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max (routes enforce 10 MB standard vs 50 MB Nitro)
    files: 4,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseMime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    const isSafeExt = ALLOWED_EXTENSIONS.has(ext);
    const isAllowedMime = ALLOWED_MIME_TYPES.has(baseMime) || (baseMime === 'application/octet-stream' && isSafeExt);
    if (!isAllowedMime || !isSafeExt) {
      cb(new Error('Desteklenmeyen dosya türü. İzin verilenler: görsel, video, ses, PDF, metin veya ZIP.'));
      return;
    }
    cb(null, true);
  },
});

export function enforceUserUploadLimit(
  db: Database.Database,
  userId: string,
  files: Express.Multer.File[]
): { ok: true; maxMb: number } | { ok: false; maxMb: number } {
  const { isNitro } = isUserNitroActive(db, userId);
  const maxMb = isNitro ? 50 : 10;
  const maxBytes = maxMb * 1024 * 1024;
  const oversized = files.some((f) => f.size > maxBytes);
  if (oversized) {
    for (const f of files) {
      try {
        if (f.path && fs.existsSync(f.path)) {
          fs.unlinkSync(f.path);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    return { ok: false, maxMb };
  }
  return { ok: true, maxMb };
}

export function sanitizeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\-\s()]/g, '_').slice(0, 120) || 'dosya';
}
