// test/setup.js — Vitest setup loaded for every test file.
// Runs before each spec; clears storage so localStorage state from one
// test does not leak into the next.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete window.__DATIQ_RUNTIME__;
});

// jsdom intentionally omits these browser APIs. The app uses them only for
// progressive enhancement / export behaviour, so deterministic no-op stubs
// are sufficient for component tests.
Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
