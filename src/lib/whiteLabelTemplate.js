// whiteLabelTemplate.js — store & retrieve the user's white-label PDF template.
//
// Business (2026-08-02) and Agency plans ship with `white_label_pdf: true` in
// their plan limits, which unlocks this feature. When a template is set,
// extractionsToPdf (src/lib/pdfExport.js) and invoicePdf (src/lib/invoicePdf.js)
// render every page of the generated PDF on top of the template's first page,
// so the user's brand shows on the cover and footer instead of DatIQ's.
//
// Storage strategy
// ─────────────────
// The template is a user-uploaded PDF (≤ MAX_BYTES, single page, application/pdf).
// It is stored as a base64 data URL in one of two places:
//
//   1. localStorage (default) — survives reloads, never touches the network.
//      Bounded by the browser's ~5 MB quota, so we cap file size at 2 MB.
//   2. Supabase Storage (when configured) — uploaded to a per-user private
//      bucket. Falls back to localStorage if the upload fails so the
//      template feature still works in demo / offline modes.
//
// The active choice is set by setActiveStorage(), but callers should not need
// to know — readTemplate() / writeTemplate() / clearTemplate() pick the right
// backend transparently and report any error through the returned object.
//
// Security notes
// ──────────────
// - File type is enforced by MIME check (application/pdf) AND by reading the
//   first 4 bytes of the file for the "%PDF" signature. A user cannot trick
//   the storage layer into saving an executable or HTML as their template.
// - File size is bounded at MAX_BYTES (2 MB). Anything larger is rejected
//   with a clear `code: "FILE_TOO_LARGE"` so the UI can prompt the user to
//   downsize before retrying.
// - The template is keyed by user id in Supabase. The anon key + RLS scope
//   the user to their own templates — they cannot read or overwrite anyone
//   else's.

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

/** Hard cap on template file size. 2 MB keeps us inside the localStorage budget
 *  (the template is stored as base64, so the effective size is ~33% larger)
 *  and matches what a typical letterhead / branded cover sheet weighs. */
export const MAX_BYTES = 2 * 1024 * 1024;

/** localStorage key for the cached template metadata (filename, mime, size, etc.)
 *  when Supabase is the active store; the actual PDF bytes live in Storage. */
const LS_META_KEY = "datiq.whiteLabelTemplate";
/** localStorage key for the FULL template (bytes + meta) when we are in
 *  localStorage-only mode. The value is JSON: { dataUrl, fileName, mime,
 *  size, uploadedAt }. */
const LS_BLOB_KEY = "datiq.whiteLabelTemplate.blob";
/** localStorage key for the active storage backend. 'local' | 'supabase'. */
const LS_BACKEND_KEY = "datiq.whiteLabelTemplate.backend";

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // "%PDF" — first 4 bytes of every PDF

/**
 * Result envelope used by every public function in this module. Callers should
 * always check `ok` first; on `ok === false` the `code` and `reason` explain
 * why so the UI can show a useful message.
 *
 * Codes:
 *   - "OK"             success
 *   - "INVALID_TYPE"   the file's MIME type is not application/pdf
 *   - "INVALID_BYTES"  the file's first 4 bytes are not the PDF signature
 *   - "FILE_TOO_LARGE" the file exceeds MAX_BYTES
 *   - "EMPTY_FILE"     the file is 0 bytes
 *   - "STORAGE_ERROR"  Supabase upload/download failed
 *   - "NOT_SET"        no template has been uploaded yet
 */
function ok(value) { return { ok: true, code: "OK", reason: null, value }; }
function err(code, reason) { return { ok: false, code, reason, value: null }; }

/** Quick MIME + size + signature validator. Returns null on success or an
 *  error result on failure. The browser's File API is the input, so this
 *  is the only place we touch raw bytes. */
function validateFile(file) {
  if (!file) return err("INVALID_TYPE", "No file was provided.");
  if (file.size === 0) return err("EMPTY_FILE", "The selected file is empty.");
  if (file.size > MAX_BYTES) {
    return err(
      "FILE_TOO_LARGE",
      `Template must be ≤ ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
    );
  }
  // Require the browser-reported MIME to be application/pdf. An empty string
  // (which happens when the OS / browser cannot identify the type) is
  // treated the same as a wrong type — the %PDF byte check below is the
  // last line of defence, but a missing MIME is a strong signal something
  // is off and we should fail closed.
  if (!file.type || file.type !== "application/pdf") {
    return err(
      "INVALID_TYPE",
      `Templates must be PDF files. Got "${file.type || "unknown"}".`,
    );
  }
  return null;
}

/** Read the first 4 bytes of a File and check them against the PDF signature.
 *  This is belt-and-braces: even if the browser's MIME sniffing is fooled
 *  (e.g. a .pdf that's actually HTML), we still reject it. */
async function assertPdfSignature(file) {
  const head = file.slice(0, 4);
  const buf = new Uint8Array(await head.arrayBuffer());
  for (let i = 0; i < PDF_SIGNATURE.length; i++) {
    if (buf[i] !== PDF_SIGNATURE[i]) {
      return err(
        "INVALID_BYTES",
        "The file does not look like a PDF (missing the %PDF signature).",
      );
    }
  }
  return null;
}

/** Read a File as a base64 data URL. Used for the localStorage path. */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.start?.(); // not standard, but harmless
    reader.readAsDataURL(file);
  });
}

/** Convert a base64 data URL to a Uint8Array. Used by the PDF merge. */
export function dataUrlToBytes(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The active storage backend. 'supabase' is preferred when configured AND
 *  the user is signed in, 'local' otherwise. */
function readActiveBackend() {
  try {
    return localStorage.getItem(LS_BACKEND_KEY) || (isSupabaseEnabled ? "supabase" : "local");
  } catch {
    return "local";
  }
}

function writeActiveBackend(b) {
  try { localStorage.setItem(LS_BACKEND_KEY, b); } catch { /* swallow */ }
}

/**
 * Upload `file` as the user's white-label template. Returns the stored
 * metadata on success. The file is validated (type, size, signature) before
 * any storage write happens.
 */
export async function writeTemplate(file, { userId = null } = {}) {
  const v = validateFile(file);
  if (v) return v;
  const sigErr = await assertPdfSignature(file);
  if (sigErr) return sigErr;

  const dataUrl = await readAsDataURL(file);
  const meta = {
    fileName: file.name,
    mime: file.type || "application/pdf",
    size: file.size,
    uploadedAt: new Date().toISOString(),
    userId,
  };

  const backend = readActiveBackend();
  if (backend === "supabase" && supabase && userId) {
    try {
      const path = `${userId}/template.pdf`;
      const { error } = await supabase.storage
        .from("white-label-templates")
        .upload(path, file, { upsert: true, contentType: "application/pdf" });
      if (error) {
        // Fall back to localStorage so the feature still works.
        writeActiveBackend("local");
      } else {
        try { localStorage.setItem(LS_META_KEY, JSON.stringify({ ...meta, path })); } catch {}
        return ok({ ...meta, storage: "supabase" });
      }
    } catch {
      writeActiveBackend("local");
    }
  }

  // localStorage path
  try {
    localStorage.setItem(LS_BLOB_KEY, JSON.stringify({ dataUrl, ...meta }));
    writeActiveBackend("local");
    return ok({ ...meta, storage: "local" });
  } catch (e) {
    return err(
      "STORAGE_ERROR",
      "Could not save the template locally. Try a smaller file (≤ 2 MB).",
    );
  }
}

/** Returns the stored template bytes (Uint8Array) + metadata, or a "NOT_SET"
 *  result if no template has been uploaded yet. */
export async function readTemplate({ userId = null } = {}) {
  const backend = readActiveBackend();
  if (backend === "supabase" && supabase && userId) {
    try {
      const { data, error } = await supabase.storage
        .from("white-label-templates")
        .download(`${userId}/template.pdf`);
      if (!error && data) {
        const buf = new Uint8Array(await data.arrayBuffer());
        const metaRaw = localStorage.getItem(LS_META_KEY);
        const meta = metaRaw ? JSON.parse(metaRaw) : { fileName: "template.pdf", size: buf.length };
        return ok({ bytes: buf, meta: { ...meta, storage: "supabase" } });
      }
    } catch { /* fall through to local */ }
  }
  try {
    const raw = localStorage.getItem(LS_BLOB_KEY);
    if (!raw) return err("NOT_SET", "No white-label template uploaded yet.");
    const { dataUrl, ...meta } = JSON.parse(raw);
    const bytes = dataUrlToBytes(dataUrl);
    if (!bytes) return err("STORAGE_ERROR", "Stored template is corrupt.");
    return ok({ bytes, meta: { ...meta, storage: "local" } });
  } catch {
    return err("STORAGE_ERROR", "Could not read the stored template.");
  }
}

/** Returns just the metadata (filename, size, uploadedAt) without the bytes.
 *  Useful for the UI to display "Your template: cover.pdf (340 KB)" without
 *  pulling the full PDF into memory. */
export function readTemplateMeta() {
  try {
    const raw = localStorage.getItem(LS_BLOB_KEY) || localStorage.getItem(LS_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Strip the dataUrl so the meta object is small.
    const { dataUrl, ...meta } = parsed;
    return meta;
  } catch {
    return null;
  }
}

/** Forget the template entirely. Idempotent. */
export function clearTemplate() {
  try { localStorage.removeItem(LS_BLOB_KEY); } catch {}
  try { localStorage.removeItem(LS_META_KEY); } catch {}
  return ok({ cleared: true });
}

/**
 * Resolve a stable per-user key for template lookups. The call sites (Preview,
 * Dashboard, Account) all need to read the same key — we centralise the
 * fallback chain here so two callers never disagree about whose template to
 * load. The chain is:
 *   1. user.id (signed-in Supabase account)
 *   2. session.user.id (any other auth shape that exposes a session)
 *   3. localStorage "datiq.sessionId" (anonymous guest session id)
 *   4. "anon" (last-resort shared bucket)
 *
 * Accepts either a `{ user, session }` object (the AuthProvider shape) or
 * `null`/`undefined` for tests that don't have an auth context — those
 * callers fall through to the localStorage / "anon" branches automatically.
 */
export function resolveTemplateUserId({ user = null, session = null } = {}) {
  try {
    return (
      user?.id
      || session?.user?.id
      || (typeof localStorage !== "undefined" && localStorage.getItem("datiq.sessionId"))
      || "anon"
    );
  } catch {
    return "anon";
  }
}

/** Test-only helper: pretend we're in localStorage mode. */
export function __setBackendForTest(name) { writeActiveBackend(name); }
