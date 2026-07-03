// Direct photo upload from the "GBP Photo Drop" iOS Shortcut.
//
// Writes raw bytes straight into the GBP picker's LOCAL CACHE so the picker
// sees them on its next run — bypassing the Drive for Desktop sync entirely.
//
// Contract (matches scripts/gbp-photo-pick.mjs in SEO-Agents-App):
//   - Accepted exts: .jpg .jpeg .png .heic .heif .webp  (case-insensitive)
//   - Stored flat at the cache root (basename only — no subfolders)
//   - Dedup by basename + byte size: identical re-upload = no-op (200, skipped)
//   - Same name + different size = overwrite (treated as an update)
//   - HEIC uploaded raw — pipeline converts in-memory at score time only
//
// Auth: Bearer token = GBP_UPLOAD_TOKEN env var. Shortcut sends the same value.
// Body: raw bytes. Filename: X-Filename header (URL-encoded). Method: PUT.

import fs from 'node:fs';
import path from 'node:path';

import { sendJson } from '../lib/http.mjs';
import {
  gbpPhotosFolder, gbpUploadToken, gbpUploadMaxBytes, GBP_PHOTO_EXTS,
} from '../lib/config.mjs';

// basename() strips any path — protect against ../ leaks and force flat storage.
function safeBasename(rawName) {
  if (!rawName) return '';
  const decoded = (() => { try { return decodeURIComponent(rawName); } catch { return rawName; } })();
  // path.basename on win32 also strips forward slashes; coerce backslashes too.
  const cleaned = decoded.replace(/[/\\]+/g, path.sep);
  return path.basename(cleaned).trim();
}

export async function handlePhotoUpload(req, res) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  if (!gbpUploadToken) {
    sendJson(res, 503, { error: 'GBP_UPLOAD_TOKEN not configured on server' });
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${gbpUploadToken}`) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  // ── Filename + extension check ───────────────────────────────────────────
  const filename = safeBasename(req.headers['x-filename']);
  if (!filename) {
    sendJson(res, 400, { error: 'Missing X-Filename header' });
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  if (!GBP_PHOTO_EXTS.has(ext)) {
    sendJson(res, 415, {
      error: `Unsupported extension: ${ext || '(none)'}`,
      accepted: [...GBP_PHOTO_EXTS],
    });
    return;
  }

  const dest = path.join(gbpPhotosFolder, filename);

  // ── Dedup check (basename + byte size), matching the picker's contract ────
  const declaredSize = Number(req.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > gbpUploadMaxBytes) {
    sendJson(res, 413, { error: 'File too large', maxBytes: gbpUploadMaxBytes });
    return;
  }
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size === declaredSize) {
      sendJson(res, 200, {
        status: 'skipped',
        reason: 'identical file already present (basename + size match)',
        path: dest,
      });
      return;
    }
  } catch (e) {
    sendJson(res, 500, { error: 'Stat failed', detail: e.message });
    return;
  }

  // ── Stream body to a temp file, then atomic rename ───────────────────────
  await fs.promises.mkdir(gbpPhotosFolder, { recursive: true }).catch(() => {});
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  const out = fs.createWriteStream(tmp);
  let bytes = 0;
  let tooLarge = false;

  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > gbpUploadMaxBytes) {
      tooLarge = true;
      req.destroy();
      out.destroy();
      fs.unlink(tmp, () => {});
      sendJson(res, 413, { error: 'File too large (stream)', maxBytes: gbpUploadMaxBytes });
    }
  });

  req.pipe(out);

  out.on('finish', async () => {
    if (tooLarge) return;

    // Final dedup using actual byte count (in case Content-Length was absent/wrong).
    try {
      const actualSize = fs.statSync(tmp).size;
      const hadExisting = fs.existsSync(dest);
      if (hadExisting && fs.statSync(dest).size === actualSize) {
        fs.unlink(tmp, () => {});
        sendJson(res, 200, {
          status: 'skipped',
          reason: 'identical file already present',
          path: dest,
        });
        return;
      }
      fs.renameSync(tmp, dest);
      sendJson(res, 200, {
        status: hadExisting ? 'overwritten' : 'uploaded',
        bytes: actualSize,
        filename,
        path: dest,
      });
    } catch (e) {
      fs.unlink(tmp, () => {});
      sendJson(res, 500, { error: 'Save failed', detail: e.message });
    }
  });

  out.on('error', (e) => {
    fs.unlink(tmp, () => {});
    sendJson(res, 500, { error: 'Write failed', detail: e.message });
  });
}
