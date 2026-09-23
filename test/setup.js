// test/setup.js — Vitest setup loaded for every test file.
// Runs before each spec; clears storage so localStorage state from one
// test does not leak into the next.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// In Node 24+, Node's experimental built-in localStorage is undefined when
// --localstorage-file is not provided, which collides with jsdom's window.localStorage.
// Also Node's globalThis.Storage shadows window.Storage.
// Ensure window.localStorage, window.sessionStorage, globalThis.localStorage,
// globalThis.sessionStorage, and globalThis.Storage are all valid and backed by JSDOM's Storage.
if (typeof window !== "undefined") {
  const JSDOMStorage = (window.sessionStorage && Object.getPrototypeOf(window.sessionStorage)?.constructor) || window.Storage;
  if (JSDOMStorage) {
    Object.defineProperty(globalThis, "Storage", { value: JSDOMStorage, configurable: true, writable: true });
    Object.defineProperty(window, "Storage", { value: JSDOMStorage, configurable: true, writable: true });
  }
}

function createStorage() {
  const map = new Map();
  const proto = typeof Storage !== "undefined" ? Storage.prototype : Object.prototype;
  const store = Object.create(proto);
  store.getItem = (k) => (map.has(String(k)) ? map.get(String(k)) : null);
  store.setItem = function (k, v) {
    if (typeof Storage !== "undefined" && Storage.prototype.setItem && Storage.prototype.setItem !== proto.setItem) {
      return Storage.prototype.setItem.call(this, k, v);
    }
    map.set(String(k), String(v));
  };
  store.removeItem = (k) => { map.delete(String(k)); };
  store.clear = () => { map.clear(); };
  Object.defineProperty(store, "length", { get: () => map.size, configurable: true });
  store.key = (i) => Array.from(map.keys())[i] ?? null;
  return store;
}

const localStore = createStorage();
const sessionStore = (typeof window !== "undefined" && window.sessionStorage) || createStorage();

Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: sessionStore, configurable: true, writable: true });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { value: localStore, configurable: true, writable: true });
  Object.defineProperty(window, "sessionStorage", { value: sessionStore, configurable: true, writable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStore.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  if (typeof window !== "undefined") delete window.__DATIQ_RUNTIME__;
});

// jsdom intentionally omits these browser APIs. The app uses them only for
// progressive enhancement / export behaviour, so deterministic no-op stubs
// are sufficient for component tests.
// Guarded so a spec can opt into `@vitest-environment node` (e.g. the
// engagement suites, which run a real Postgres that jsdom's fetch cannot load).
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    writable: true,
  });
}

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
