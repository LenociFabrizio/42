/**
 * upload.js (middleware)
 * ------------------------------------------------------------
 * Upload di immagini (avatar, foto percorsi/eventi/club, veicoli).
 *
 * Storage:
 *   - PRODUZIONE (Vercel): se è presente BLOB_READ_WRITE_TOKEN, i file
 *     vengono caricati su Vercel Blob e si salva l'URL pubblico restituito.
 *   - SVILUPPO (locale): fallback su filesystem in public/uploads.
 *
 * Multer usa memoryStorage: il file resta in RAM (req.file.buffer) finché
 * `persistUpload` non lo scrive sulla destinazione scelta.
 * ------------------------------------------------------------
 */
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

function fileFilter(_req, file, cb) {
  if (ALLOWED.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Formato immagine non supportato (usa JPG, PNG, WEBP o GIF).'));
}

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 MB
});

/** Genera un nome file sicuro e (quasi) univoco. */
function safeName(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  const base =
    path
      .basename(originalname, ext)
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 40) || 'file';
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${base}-${unique}${ext}`;
}

/**
 * Persiste un file caricato e restituisce l'URL pubblico.
 * @param {Express.Multer.File} file  file da multer (memoryStorage → .buffer)
 * @param {string} subdir             sottocartella logica (es. 'avatars', 'routes')
 * @returns {Promise<string|null>} URL pubblico dell'immagine
 */
export async function persistUpload(file, subdir = 'misc') {
  if (!file) return null;
  const name = safeName(file.originalname);

  // Produzione: Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`${subdir}/${name}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  }

  // Serverless (Vercel) senza Blob configurato: filesystem in sola lettura.
  if (process.env.VERCEL) {
    const err = new Error(
      'Upload immagini non configurato: aggiungi un Vercel Blob store e la variabile BLOB_READ_WRITE_TOKEN.'
    );
    err.status = 503;
    throw err;
  }

  // Sviluppo locale: filesystem in public/uploads/<subdir>
  const dir = path.join(config.paths.uploads, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return `/uploads/${subdir}/${name}`;
}
