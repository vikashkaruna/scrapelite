import { describe, expect, it } from "vitest";
import { classifyError, DELETE_ERROR, formatDetail, LOAD_ERROR, SAVE_ERROR } from "./errorMessages.js";

describe("friendly error classification", () => {
  it.each([
    ["Failed to fetch", "Couldn't reach the page"],
    ["CORS policy blocked this request", "This page blocked the request"],
    ["API 401 unauthorized", "Login required"],
    ["API 403 forbidden", "Access forbidden"],
    ["API 404 not found", "Page not found"],
    ["429 rate limit", "Slow down a moment"],
    ["503 service unavailable", "Service temporarily unavailable"],
    ["Request timed out", "Request timed out"],
    ["Invalid URL", "Invalid URL"],
    ["Supabase permission denied for table", "Database error"],
    ["failed to fetch dynamically imported module", "App update available"],
  ])("maps %s to a safe action-oriented title", (message, title) => {
    expect(classifyError(new Error(message)).title).toBe(title);
  });

  it("falls back safely and exposes controlled technical details for developers", () => {
    expect(classifyError("unrecognised failure").title).toBe("Something went wrong");
    const error = new TypeError("boom");
    error.stack = "TypeError: boom\nfirst frame\nsecond frame";
    expect(formatDetail(error)).toBe("TypeError: boom\n\nfirst frame\nsecond frame");
    expect(formatDetail(null)).toBeNull();
    expect(SAVE_ERROR.title).toContain("save");
    expect(LOAD_ERROR.title).toContain("load");
    expect(DELETE_ERROR.title).toContain("delete");
  });
});
