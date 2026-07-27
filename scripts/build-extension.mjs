#!/usr/bin/env node
// scripts/build-extension.mjs
//
// Build the DatIQ browser extension.
//
//   node scripts/build-extension.mjs
//
// What it does:
//   1. Reads the source tree at extensions/datiq-extension/.
//   2. Optionally generates PNG icons from icons/icon.svg (requires
//      `sharp` — only used during release builds, not in tests).
//   3. Validates manifest.json against the MV3 spec.
//   4. Bundles background.js and popup.js (currently they're plain ES
//      modules, no bundling needed).
//   5. Writes the production-ready tree to
//      dist-extension/ — load that directory in Chrome via
//      chrome://extensions → "Load unpacked".
//
// In CI, a separate workflow packages dist-extension/ into a zip and
// uploads it to the Chrome Web Store / Firefox Add-ons (operator task;
// documented in ENABLEMENTS.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "extensions", "datiq-extension");
const OUT = path.join(ROOT, "dist-extension");

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else copyFile(s, d);
  }
}

function validateManifest(manifest) {
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
  if (!manifest.name) errors.push("name is required");
  if (!manifest.version) errors.push("version is required");
  if (!manifest.background?.service_worker) errors.push("background.service_worker is required (MV3)");
  if (!Array.isArray(manifest.permissions)) errors.push("permissions must be an array");
  return errors;
}

async function maybeRenderIcons() {
  // Sharp is an optional dep — only used to rasterize the SVG. If it
  // isn't installed (e.g. during unit tests), we skip and rely on the
  // committed PNGs.
  let sharp;
  try { sharp = (await import("sharp")).default; }
  catch { return; }
  if (!fs.existsSync(path.join(SRC, "icons", "icon.svg"))) return;
  const svg = fs.readFileSync(path.join(SRC, "icons", "icon.svg"));
  for (const size of [16, 32, 48, 128]) {
    const out = path.join(SRC, "icons", `icon-${size}.png`);
    if (fs.existsSync(out)) continue;
    try {
      await sharp(svg).resize(size, size).png().toFile(out);
      console.log(`  rendered icons/icon-${size}.png`);
    } catch (err) {
      console.warn(`  sharp render failed for ${size}px:`, err.message);
    }
  }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source directory not found: ${SRC}`);
    process.exit(1);
  }
  console.log(`[build-extension] src: ${SRC}`);
  console.log(`[build-extension] out: ${OUT}`);

  // 1. Clean output
  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDir(OUT);

  // 2. Validate manifest
  const manifest = readJSON(path.join(SRC, "manifest.json"));
  const errs = validateManifest(manifest);
  if (errs.length) {
    console.error("[build-extension] manifest validation failed:");
    for (const e of errs) console.error("  -", e);
    process.exit(1);
  }
  console.log(`[build-extension] manifest: ${manifest.name} v${manifest.version} (MV3)`);

  // 3. Render icons if possible
  maybeRenderIcons().then(() => {
    // 4. Copy tree
    copyTree(SRC, OUT);
    console.log(`[build-extension] copied extension to ${OUT}`);
    console.log(`[build-extension] load in Chrome via chrome://extensions → "Load unpacked"`);
  }).catch((err) => {
    console.error("[build-extension] icon render failed:", err.message);
    copyTree(SRC, OUT);
  });
}

main();
