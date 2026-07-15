import { describe, expect, it } from "vitest";
import { validatePublicHttpUrl } from "./publicUrl.js";

describe("validatePublicHttpUrl", () => {
  it.each([
    ["https://example.com/path?query=value", "https://example.com/path?query=value"],
    ["http://public.example.org", "http://public.example.org/"],
  ])("accepts a public HTTP(S) URL", (input, expected) => {
    expect(validatePublicHttpUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    "",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://localhost:3000",
    "https://api.localhost",
    "http://service.local/path",
    "http://127.0.0.1:8080",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[fd00::1]",
    "http://[fe80::1]",
    "http://[::ffff:127.0.0.1]",
  ])("rejects unsafe or non-public targets: %s", (input) => {
    expect(validatePublicHttpUrl(input)).toEqual({
      ok: false,
      error: "A valid public HTTP(S) URL is required.",
    });
  });
});
