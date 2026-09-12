import { describe, it, expect, beforeEach } from "vitest";
import { readPageCache, writePageCache, clearPageCache, __testing } from "./pageCache.js";

describe("pageCache utility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null for non-existent cache key", () => {
    expect(readPageCache("nonexistent")).toBeNull();
  });

  it("writes and reads cached data successfully", () => {
    const data = { items: [1, 2, 3], title: "Accounts" };
    const ok = writePageCache("testKey", data);
    expect(ok).toBe(true);

    const cached = readPageCache("testKey");
    expect(cached).not.toBeNull();
    expect(cached.data).toEqual(data);
    expect(cached.cachedAt).toBeTypeOf("number");
    expect(cached.ageMs).toBeGreaterThanOrEqual(0);
  });

  it("returns null when cache has expired beyond maxAgeMs", () => {
    const data = { foo: "bar" };
    const writeTime = 1000000;
    writePageCache("expiredKey", data, writeTime);

    // Read 2 hours later with 1 hour TTL
    const readTime = writeTime + 2 * 60 * 60 * 1000;
    const cached = readPageCache("expiredKey", 60 * 60 * 1000, readTime);
    expect(cached).toBeNull();
  });

  it("handles corrupted JSON gracefully without throwing", () => {
    localStorage.setItem(`${__testing.PREFIX}corrupt`, "invalid-json{{");
    expect(readPageCache("corrupt")).toBeNull();
  });

  it("clears cached item when clearPageCache is called", () => {
    writePageCache("toDelete", { a: 1 });
    expect(readPageCache("toDelete")).not.toBeNull();

    clearPageCache("toDelete");
    expect(readPageCache("toDelete")).toBeNull();
  });
});
