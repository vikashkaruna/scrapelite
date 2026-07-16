// test/fixtures/resetLocalStorage.js
// Helper for tests that need to reset localStorage to a known shape.
// Two flavours: a synchronous helper for vitest unit/integration tests
// (clears all datiq.* keys) and an async helper for Playwright specs that
// need the same shape inside a `page.evaluate()` block.

/**
 * Synchronously clear every `datiq.*` localStorage key. Run inside a vitest
 * beforeEach or at the start of a test that depends on a known-clean state.
 *
 * @param {Storage} [storage]
 */
export function resetLocalStorage(storage = window.localStorage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith("datiq.")) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

/**
 * Async version of `resetLocalStorage` for use inside `page.evaluate()`
 * (Playwright). Resolves when the synchronous removeItem calls have all
 * returned — keeps the call-site `await`able and the intent obvious.
 *
 * @param {Storage} [storage]
 */
export async function resetLocalStorageAsync(storage = window.localStorage) {
  resetLocalStorage(storage);
}
