// src/lib/whiteLabelTemplate.test.js
// Unit tests for the white-label PDF template store.
//
// Covers:
//   1. happy path (write → read → clear) with a real PDF-shaped File
//   2. validation: type, size, signature
//   3. dataUrlToBytes round-trip
//   4. clearTemplate is idempotent
//
// Security-focused: every input that could come from an attacker (a file
// selected via the browser's file picker) is validated. A test that submits
// a fake "PDF" with the wrong first 4 bytes is included so a future refactor
// that drops the %PDF check fails loudly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES,
  __setBackendForTest,
  clearTemplate,
  dataUrlToBytes,
  readTemplate,
  readTemplateMeta,
  writeTemplate,
} from "./whiteLabelTemplate.js";

// jsdom does not implement FileReader, so we provide a minimal in-memory
// reader for the duration of these tests.
class FakeFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.result = null;
  }
  readAsDataURL(file) {
    // Yield on the next microtask so callers' await chain still works.
    queueMicrotask(() => {
      try {
        this.result = `data:${file.type || "application/octet-stream"};base64,${bytesToBase64(file._bytes)}`;
        this.onload?.();
      } catch (e) {
        this.onerror?.(e);
      }
    });
  }
}

function bytesToBase64(bytes) {
  // Standard btoa trick; works for ASCII bytes (PDF bytes are all < 0x80 in
  // the headers we care about).
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}

function bytesToBase64Safe(bytes) {
  return bytesToBase64(bytes);
}

function makePdfFile({ name = "template.pdf", size, signature = true, mime = "application/pdf", badSignatureAt = -1 } = {}) {
  // A minimal valid-looking PDF payload: %PDF header + a couple of body
  // bytes + %%EOF. Real PDFs are much longer but the validator only inspects
  // the first 4 bytes and the size cap.
  const head = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  const tail = new Uint8Array([0x25, 0x25, 0x45, 0x4f, 0x46]); // "%%EOF"
  let body;
  if (typeof size === "number") {
    body = new Uint8Array(Math.max(0, size - head.length - tail.length));
  } else {
    body = new Uint8Array(64);
  }
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head, 0);
  out.set(body, head.length);
  out.set(tail, head.length + body.length);
  if (!signature) {
    // Replace the first 4 bytes with junk so the %PDF check fails.
    out[0] = 0x00; out[1] = 0x00; out[2] = 0x00; out[3] = 0x00;
  }
  if (badSignatureAt >= 0) {
    out[badSignatureAt] = 0x42; // 'B'
  }
  const file = {
    name,
    type: mime,
    size: out.length,
    _bytes: out,
    slice(start, end) {
      return { arrayBuffer: async () => out.slice(start, end).buffer };
    },
    async arrayBuffer() { return out.buffer; },
  };
  return file;
}

beforeEach(() => {
  // jsdom: stub FileReader so writeTemplate's readAsDataURL works.
  globalThis.FileReader = FakeFileReader;
  localStorage.clear();
  __setBackendForTest("local");
});

afterEach(() => {
  localStorage.clear();
});

describe("whiteLabelTemplate — write/read/clear (happy path)", () => {
  it("round-trips a valid PDF through localStorage and produces the same bytes", async () => {
    const file = makePdfFile({ name: "cover.pdf", size: 1024 });
    const writeRes = await writeTemplate(file, { userId: "u1" });
    expect(writeRes.ok).toBe(true);
    expect(writeRes.value.storage).toBe("local");
    expect(writeRes.value.size).toBe(1024);

    const readRes = await readTemplate({ userId: "u1" });
    expect(readRes.ok).toBe(true);
    expect(readRes.value.bytes.length).toBe(1024);
    // The first 4 bytes round-trip as the %PDF header.
    expect(readRes.value.bytes[0]).toBe(0x25);
    expect(readRes.value.bytes[1]).toBe(0x50);
    expect(readRes.value.bytes[2]).toBe(0x44);
    expect(readRes.value.bytes[3]).toBe(0x46);
    expect(readRes.value.meta.fileName).toBe("cover.pdf");
  });

  it("readTemplateMeta returns the metadata without loading the bytes", () => {
    localStorage.setItem(
      "datiq.whiteLabelTemplate.blob",
      JSON.stringify({
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQKJcfsj6IKMSAwIG9iago=",
        fileName: "meta-only.pdf",
        size: 4321,
        uploadedAt: "2026-08-02T10:00:00.000Z",
        storage: "local",
      }),
    );
    const meta = readTemplateMeta();
    expect(meta.fileName).toBe("meta-only.pdf");
    expect(meta.size).toBe(4321);
    // The dataUrl must NOT be returned in the meta object — callers may dump
    // it to the console and we don't want megabytes of base64 there.
    expect(meta.dataUrl).toBeUndefined();
  });

  it("clearTemplate is idempotent and doesn't throw when called twice", () => {
    expect(clearTemplate().ok).toBe(true);
    expect(clearTemplate().ok).toBe(true);
  });

  it("readTemplate without a stored template returns a NOT_SET error", async () => {
    const res = await readTemplate();
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NOT_SET");
  });
});

describe("whiteLabelTemplate — input validation (security)", () => {
  it("rejects files larger than MAX_BYTES (FILE_TOO_LARGE)", async () => {
    // 1 byte over the cap to make the boundary exact.
    const file = makePdfFile({ size: MAX_BYTES + 1 });
    const res = await writeTemplate(file, { userId: "u1" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("FILE_TOO_LARGE");
    // Nothing should have been written.
    expect(localStorage.getItem("datiq.whiteLabelTemplate.blob")).toBeNull();
  });

  it("accepts a file exactly at the MAX_BYTES boundary", async () => {
    const file = makePdfFile({ size: MAX_BYTES });
    const res = await writeTemplate(file, { userId: "u1" });
    expect(res.ok).toBe(true);
  });

  it("rejects files with a non-PDF MIME type (INVALID_TYPE)", async () => {
    const file = makePdfFile({ mime: "text/html" });
    const res = await writeTemplate(file, { userId: "u1" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("INVALID_TYPE");
  });

  it("rejects empty files (EMPTY_FILE)", async () => {
    const file = { name: "x.pdf", type: "application/pdf", size: 0, _bytes: new Uint8Array(0),
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    const res = await writeTemplate(file);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("EMPTY_FILE");
  });

  it("rejects files whose first 4 bytes are not %PDF (INVALID_BYTES)", async () => {
    // The MIME says PDF but the body is a PNG signature — the file picker
    // could be tricked by a renamed executable, so the byte check is the
    // last line of defence.
    const file = makePdfFile({ signature: false });
    const res = await writeTemplate(file, { userId: "u1" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("INVALID_BYTES");
  });

  it("rejects files with no MIME type (INVALID_TYPE)", async () => {
    const file = makePdfFile({ mime: "" });
    const res = await writeTemplate(file);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("INVALID_TYPE");
  });
});

describe("whiteLabelTemplate — dataUrlToBytes helper", () => {
  it("decodes a base64 data URL to a Uint8Array", () => {
    // "Hello" → base64 "SGVsbG8="
    const out = dataUrlToBytes("data:application/pdf;base64,SGVsbG8=");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...out)).toBe("Hello");
  });

  it("returns null for a malformed data URL", () => {
    expect(dataUrlToBytes("not a data url")).toBeNull();
    expect(dataUrlToBytes("data:image/png;base64,!!!not-base64!!!")).toBeNull();
  });

  it("returns null for empty or non-string input", () => {
    expect(dataUrlToBytes(null)).toBeNull();
    expect(dataUrlToBytes(undefined)).toBeNull();
    expect(dataUrlToBytes("")).toBeNull();
  });
});
