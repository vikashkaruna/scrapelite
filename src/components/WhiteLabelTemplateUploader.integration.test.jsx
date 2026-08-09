// src/components/WhiteLabelTemplateUploader.integration.test.jsx
// Integration test for the Account-page white-label PDF uploader.
//
//   - When the plan DOESN'T allow white-label PDF, the uploader renders in
//     a "locked" state with an upgrade prompt.
//   - When the plan DOES allow it, the user can pick a PDF, the file is
//     validated and stored, and the current template is shown.
//   - The clear button removes the template and re-renders the empty state.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import WhiteLabelTemplateUploader from "./WhiteLabelTemplateUploader.jsx";
import {
  __setBackendForTest,
  clearTemplate,
  readTemplate,
} from "../lib/whiteLabelTemplate.js";

beforeEach(() => {
  // jsdom: stub FileReader for the writeTemplate path. We faithfully
  // base64-encode the file bytes so the stored dataUrl matches the
  // declared size, not a tiny placeholder.
  class FakeFileReader {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.result = null;
    }
    readAsDataURL(file) {
      queueMicrotask(() => {
        const bytes = file._bytes || new Uint8Array(0);
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        const b64 = typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
        this.result = `data:${file.type};base64,${b64}`;
        this.onload?.();
      });
    }
  }
  globalThis.FileReader = FakeFileReader;
  localStorage.clear();
  __setBackendForTest("local");
});

function pdfFile({ name = "cover.pdf", size = 1024 } = {}) {
  const head = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const tail = new Uint8Array([0x25, 0x25, 0x45, 0x4f, 0x46]);
  const body = new Uint8Array(Math.max(0, size - head.length - tail.length));
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head); out.set(body, head.length); out.set(tail, head.length + body.length);
  return {
    name,
    type: "application/pdf",
    size: out.length,
    _bytes: out,
    slice(start, end) { return { arrayBuffer: async () => out.slice(start, end).buffer }; },
    async arrayBuffer() { return out.buffer; },
  };
}

describe("WhiteLabelTemplateUploader", () => {
  it("renders a locked state with an upgrade hint when canManage=false", () => {
    render(<WhiteLabelTemplateUploader canManage={false} />);
    expect(screen.getByText(/White-label PDF/i)).toBeInTheDocument();
    expect(screen.getByText(/not available on your tier/i)).toBeInTheDocument();
    // No file input should be visible.
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("renders the upload controls when canManage=true", () => {
    render(<WhiteLabelTemplateUploader canManage={true} />);
    expect(screen.getByText(/White-label PDF template/i)).toBeInTheDocument();
    expect(document.querySelector("input[type=file]")).not.toBeNull();
  });

  it("accepts a valid PDF, persists it, and shows the current-template panel", async () => {
    render(<WhiteLabelTemplateUploader canManage={true} />);
    const input = document.querySelector("input[type=file]");
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdfFile({ name: "brand.pdf" })] } });
      // Let the queueMicrotask in FakeFileReader run.
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText(/Saved brand\.pdf/)).toBeInTheDocument();
    // The current-template panel should now show the filename.
    expect(screen.getByText("brand.pdf")).toBeInTheDocument();
    // And the storage layer should have the bytes.
    const res = await readTemplate();
    expect(res.ok).toBe(true);
    expect(res.value.bytes.length).toBe(1024);
  });

  it("rejects a file with the wrong MIME type and surfaces an inline error", async () => {
    render(<WhiteLabelTemplateUploader canManage={true} />);
    const input = document.querySelector("input[type=file]");
    const bad = { name: "x.html", type: "text/html", size: 10,
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await act(async () => {
      fireEvent.change(input, { target: { files: [bad] } });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText(/Templates must be PDF files/)).toBeInTheDocument();
    // Nothing should have been persisted.
    const res = await readTemplate();
    expect(res.code).toBe("NOT_SET");
  });

  it("the Clear button wipes the stored template and hides the current panel", async () => {
    // Seed a template first.
    const input_setup = document.createElement("input");
    void input_setup;
    clearTemplate();
    localStorage.setItem(
      "datiq.whiteLabelTemplate.blob",
      JSON.stringify({
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        fileName: "to-clear.pdf",
        size: 100,
        uploadedAt: "2026-08-02T10:00:00.000Z",
        storage: "local",
      }),
    );
    // Stub the confirm dialog so the test doesn't hang.
    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);

    render(<WhiteLabelTemplateUploader canManage={true} />);
    // The current-template panel should show the seeded file.
    expect(screen.getByText("to-clear.pdf")).toBeInTheDocument();
    // Click Clear.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove/i }));
    });
    // The panel is gone.
    expect(screen.queryByText("to-clear.pdf")).toBeNull();

    window.confirm = originalConfirm;
  });
});
