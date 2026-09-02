// Regression: a degraded template store must not break every template link.
//
// The bug: handleGet returned the CATALOGUE and exited before it ever looked
// at `?key=`, so a 200 came back with a `templates` array and no `template`
// field. The runner trusted the field that 200 promised and died on
// `r.template.input_schema` — surfacing a missing migration as a TypeError,
// on every template at once, while the catalogue kept listing all of them
// (it is served from the same seeds).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../functions/lib/templateStore.js", () => ({
  // The exact shape a missing `workflow_templates` table produces.
  listTemplates: vi.fn(async () => ({ ok: false, reason: 'relation "workflow_templates" does not exist', rows: [] })),
  ensureSeeded: vi.fn(async () => ({ ok: false })),
  getTemplate: vi.fn(async () => null),
  getRun: vi.fn(async () => null),
  listRuns: vi.fn(async () => []),
  createRun: vi.fn(async () => ({ ok: false })),
  finishRun: vi.fn(async () => ({ ok: false })),
  failRun: vi.fn(async () => ({ ok: false })),
  serviceDb: vi.fn(() => null),
}));

const { handler } = await import("../functions/templates.js");
const { SEED_TEMPLATES } = await import("../../src/lib/templates/seedTemplates.js");

const get = (qs) => handler({ httpMethod: "GET", queryStringParameters: qs, headers: {} });
const published = SEED_TEMPLATES.filter((t) => t.status === "published");

describe("templates GET with an unreachable store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still lists the catalogue (unchanged behaviour)", async () => {
    const res = await get({});
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.templates).toHaveLength(published.length);
    expect(body.degraded).toBe(true);
  });

  // The core regression. Pre-fix this returned `{ templates: [...] }`.
  it.each(published.map((t) => t.template_key))(
    "returns a real `template` for ?key=%s instead of the catalogue",
    async (key) => {
      const res = await get({ key });
      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.templates).toBeUndefined();
      expect(body.template).toBeTruthy();
      expect(body.template.template_key).toBe(key);
      // This is the exact property the runner dereferenced and crashed on.
      expect(body.template.input_schema).toBeTruthy();
      expect(Array.isArray(body.template.input_schema.fields)).toBe(true);
      expect(body.degraded).toBe(true);
    },
  );

  it("404s an unknown key rather than handing back the catalogue", async () => {
    const res = await get({ key: "no_such_template" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).templates).toBeUndefined();
  });
});
