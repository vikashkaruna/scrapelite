import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmail, sendExtractionsEmail } from "./emailService.js";

/**
 * U-39..41 — emailService is the email-share backend for the Dashboard's
 * "Email" action. Delivery is delegated: webhook → email API → mailto.
 * Tests stub `fetch` and `document.createElement` to assert each path.
 */

const WEBHOOK_URL = "https://hook.example.com/email";
const EMAIL_API_URL = "https://api.example.com/email";

let env;

beforeEach(() => {
  env = { ...process.env };
});

afterEach(() => {
  process.env = env;
  vi.restoreAllMocks();
});

function stubConfig({ webhook = false, email = false }) {
  // Set the VITE_* env vars the runtime config reads at module load.
  // Because config.js is already loaded, we re-evaluate its truthy helpers
  // by setting the process-level env (which config.js reads on import).
  // Since config.js is a module that ran once, we instead reach into the
  // live module by re-importing with the env set.
  vi.resetModules();
  if (webhook) process.env.VITE_WEBHOOK_URL = WEBHOOK_URL;
  else delete process.env.VITE_WEBHOOK_URL;
  if (email) process.env.VITE_EMAIL_API_URL = EMAIL_API_URL;
  else delete process.env.VITE_EMAIL_API_URL;
}

const SAMPLE_ITEM = {
  url: "https://example.com/a",
  page_title: "Example A",
  ai_summary: "A short summary.",
  created_at: "2026-07-15T10:00:00.000Z",
  headings: [{ tag: "h1", text: "Heading 1" }],
  links: [{ text: "Link 1", href: "https://example.com/l" }],
};

describe("buildEmail", () => {
  it("composes a subject + body for one item", async () => {
    vi.resetModules();
    const { buildEmail } = await import("./emailService.js");
    const { subject, body } = buildEmail([SAMPLE_ITEM]);
    expect(subject).toBe("DatIQ — 1 extraction");
    expect(body).toContain("Example A");
    expect(body).toContain("https://example.com/a");
  });

  it("pluralises 'extractions' for multiple items", async () => {
    vi.resetModules();
    const { buildEmail } = await import("./emailService.js");
    const { subject } = buildEmail([SAMPLE_ITEM, SAMPLE_ITEM]);
    expect(subject).toBe("DatIQ — 2 extractions");
  });
});

describe("sendExtractionsEmail — webhook path (U-39)", () => {
  it("200 → returns {via:'webhook', count}", async () => {
    stubConfig({ webhook: true });
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock;

    const { sendExtractionsEmail } = await import("./emailService.js");
    const r = await sendExtractionsEmail({
      to: ["a@b.com", "c@d.com"],
      items: [SAMPLE_ITEM],
    });
    expect(r.via).toBe("webhook");
    expect(r.count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendExtractionsEmail — webhook 5xx falls through to email API (U-40)", () => {
  it("webhook 500 → falls through to email API; API 200 → returns {via:'api'}", async () => {
    stubConfig({ webhook: true, email: true });
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock;

    const { sendExtractionsEmail } = await import("./emailService.js");
    const r = await sendExtractionsEmail({
      to: ["a@b.com"],
      items: [SAMPLE_ITEM],
    });
    expect(r.via).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("sendExtractionsEmail — both down → mailto (U-41)", () => {
  it("neither webhook nor API → triggers a mailto: anchor click", async () => {
    stubConfig({ webhook: false, email: false });
    vi.resetModules();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // Capture the mailto click without opening a real browser window.
    const click = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === "a") el.click = click;
      return el;
    });

    const { sendExtractionsEmail } = await import("./emailService.js");
    const r = await sendExtractionsEmail({
      to: ["a@b.com"],
      items: [SAMPLE_ITEM],
    });
    expect(r.via).toBe("mailto");
    expect(click).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
