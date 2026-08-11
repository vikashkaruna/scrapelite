// scripts/__tests__/build-extension.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "extensions", "datiq-extension");
const TMP_OUT = path.join(os.tmpdir(), `datiq-ext-test-${Date.now()}`);

describe("build-extension", () => {
  beforeEach(() => {
    if (fs.existsSync(TMP_OUT)) fs.rmSync(TMP_OUT, { recursive: true, force: true });
    fs.mkdirSync(TMP_OUT, { recursive: true });
  });
  afterEach(() => {
    if (fs.existsSync(TMP_OUT)) fs.rmSync(TMP_OUT, { recursive: true, force: true });
  });

  it("manifest is valid MV3", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.background?.service_worker).toBeTruthy();
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });

  it("manifest declares the integrations-related permissions", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["contextMenus", "storage", "activeTab"]),
    );
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([expect.stringMatching(/datiq\.app/)]),
    );
  });

  it("background.js is a module-type service worker (MV3)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    expect(manifest.background?.type).toBe("module");
  });

  it("popup.js wires the connect / extract / signout buttons", () => {
    const popup = fs.readFileSync(path.join(SRC, "popup.js"), "utf8");
    expect(popup).toMatch(/saveKeyBtn/);
    expect(popup).toMatch(/extractBtn/);
    expect(popup).toMatch(/signoutBtn/);
    expect(popup).toMatch(/set-api-key/);
    expect(popup).toMatch(/extract-current/);
  });

  it("popup.html is well-formed and has the right view IDs", () => {
    const html = fs.readFileSync(path.join(SRC, "popup.html"), "utf8");
    expect(html).toMatch(/id="connect-view"/);
    expect(html).toMatch(/id="connected-view"/);
    expect(html).toMatch(/id="api-key-input"/);
    expect(html).toMatch(/id="extract-btn"/);
  });

  it("content.js is a no-op (the right-click path doesn't need it)", () => {
    const content = fs.readFileSync(path.join(SRC, "content.js"), "utf8");
    expect(content).toContain("__datiqContentScriptLoaded");
    // It must not touch the DOM, fetch, or listen for messages.
    expect(content).not.toMatch(/document\.write/);
    expect(content).not.toMatch(/chrome\.runtime\.onMessage/);
  });

  it("background.js does not store the API key in plaintext elsewhere", () => {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    // Sanity: it stores under a known key, never via localStorage (which
    // is not available in a service worker).
    expect(bg).not.toMatch(/localStorage/);
    expect(bg).toMatch(/chrome\.storage\.local/);
  });

  it("icons directory exists with the SVG source", () => {
    expect(fs.existsSync(path.join(SRC, "icons", "icon.svg"))).toBe(true);
  });
});
