// netlify/__tests__/lib/hubspotService.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractionContactToHubSpotProperties,
  extractionToHubSpotCompanyProperties,
  buildContactSearchByEmail,
  buildCompanySearchByDomain,
  buildContactCreateBody,
  buildContactUpdateBody,
  buildContactUrl,
  buildContactSearchUrl,
  buildCompanyCreateUrl,
  buildCompanySearchUrl,
  pushContactToHubSpot,
  pushCompanyToHubSpot,
  pushExtractionToHubSpot,
  DEFAULT_CONTACT_MAPPING,
  DEFAULT_COMPANY_MAPPING,
  _internal,
} from "../../functions/lib/hubspotService.js";

describe("hubspotService (F-INT-2)", () => {
  describe("extractionContactToHubSpotProperties", () => {
    it("maps a person object to a HubSpot properties object", () => {
      const props = extractionContactToHubSpotProperties({
        email: "jane@acme.com",
        first_name: "Jane",
        last_name: "Doe",
        role: "VP Marketing",
      });
      expect(props).toEqual({
        email: "jane@acme.com",
        firstname: "Jane",
        lastname: "Doe",
        jobtitle: "VP Marketing",
      });
    });
    it("truncates string values to 500 chars", () => {
      const props = extractionContactToHubSpotProperties({
        email: "a@b.com",
        first_name: "x".repeat(800),
      });
      expect(props.firstname).toHaveLength(500);
    });
    it("stringifies object/array values (HubSpot properties are flat)", () => {
      const props = extractionContactToHubSpotProperties({
        email: "a@b.com",
        role: { team: "Marketing", level: "VP" },
      });
      expect(typeof props.jobtitle).toBe("string");
      expect(props.jobtitle).toMatch(/Marketing/);
    });
    it("returns {} for nullish input", () => {
      expect(extractionContactToHubSpotProperties(null)).toEqual({});
      expect(extractionContactToHubSpotProperties(undefined)).toEqual({});
    });
    it("honours a custom mapping", () => {
      const props = extractionContactToHubSpotProperties(
        { email: "a@b.com", name: "Jane", job: "CEO" },
        { email: "email", firstname: "name", jobtitle: "job" },
      );
      expect(props).toEqual({ email: "a@b.com", firstname: "Jane", jobtitle: "CEO" });
    });
  });

  describe("extractionToHubSpotCompanyProperties", () => {
    it("maps an extraction to a HubSpot company", () => {
      const props = extractionToHubSpotCompanyProperties({
        page_title: "Acme",
        host: "acme.com",
        ai_summary: "Acme does X",
        url: "https://acme.com",
      });
      expect(props).toEqual({
        name: "Acme",
        domain: "acme.com",
        description: "Acme does X",
        website: "https://acme.com",
      });
    });
    it("returns {} for nullish input", () => {
      expect(extractionToHubSpotCompanyProperties(null)).toEqual({});
    });
    it("supports dotted paths in the mapping (links[0].href)", () => {
      const props = extractionToHubSpotCompanyProperties(
        { url: "https://acme.com", links: [{ href: "https://acme.com/team" }] },
        { website: "url", social_url: "links[0].href" },
      );
      expect(props.website).toBe("https://acme.com");
      expect(props.social_url).toBe("https://acme.com/team");
    });
  });

  describe("search bodies", () => {
    it("builds an email filter for contacts", () => {
      const body = buildContactSearchByEmail("a@b.com");
      expect(body.filterGroups[0].filters[0]).toEqual({
        propertyName: "email",
        operator: "EQ",
        value: "a@b.com",
      });
    });
    it("builds a domain filter for companies", () => {
      const body = buildCompanySearchByDomain("acme.com");
      expect(body.filterGroups[0].filters[0].propertyName).toBe("domain");
      expect(body.filterGroups[0].filters[0].value).toBe("acme.com");
    });
    it("throws when email / domain is missing", () => {
      expect(() => buildContactSearchByEmail("")).toThrow();
      expect(() => buildCompanySearchByDomain("")).toThrow();
    });
  });

  describe("URL builders", () => {
    it("buildContactUrl returns the canonical /crm/v3/objects/contacts URL", () => {
      expect(buildContactUrl()).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
      expect(buildContactUrl("123")).toBe("https://api.hubapi.com/crm/v3/objects/contacts/123");
    });
    it("search and create URLs are the expected constants", () => {
      expect(buildContactSearchUrl()).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
      expect(buildCompanyCreateUrl()).toBe("https://api.hubapi.com/crm/v3/objects/companies");
      expect(buildCompanySearchUrl()).toBe("https://api.hubapi.com/crm/v3/objects/companies/search");
    });
  });

  describe("pushContactToHubSpot", () => {
    it("creates a new contact when no match is found", async () => {
      const fetchFn = vi.fn()
        // search → no match
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        // create → 201
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "c-1" }) });
      const r = await pushContactToHubSpot(
        { email: "a@b.com", firstname: "A" },
        { accessToken: "pat-xxx", fetchFn },
      );
      expect(r.ok).toBe(true);
      expect(r.id).toBe("c-1");
      expect(r.created).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      // Authorization header is set
      const searchCall = fetchFn.mock.calls[0];
      expect(searchCall[1].headers.Authorization).toBe("Bearer pat-xxx");
    });
    it("updates an existing contact when one is found", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: "c-existing" }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "c-existing" }) });
      const r = await pushContactToHubSpot(
        { email: "a@b.com" },
        { accessToken: "pat-xxx", fetchFn },
      );
      expect(r.ok).toBe(true);
      expect(r.created).toBe(false);
      // Second call should be PATCH
      expect(fetchFn.mock.calls[1][1].method).toBe("PATCH");
    });
    it("rejects when the access token is missing", async () => {
      const r = await pushContactToHubSpot({ email: "a@b.com" }, { fetchFn: vi.fn() });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/HUBSPOT_ACCESS_TOKEN/);
    });
    it("rejects when the email is missing", async () => {
      const r = await pushContactToHubSpot({}, { accessToken: "pat-xxx", fetchFn: vi.fn() });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/email/);
    });
    it("surfaces HubSpot 4xx errors with the body", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => '{"message":"bad"}' });
      const r = await pushContactToHubSpot({ email: "a@b.com" }, { accessToken: "pat-xxx", fetchFn });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/hubspot_400/);
    });
  });

  describe("pushCompanyToHubSpot", () => {
    it("creates a company when no match is found", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "co-1" }) });
      const r = await pushCompanyToHubSpot(
        { domain: "acme.com", name: "Acme" },
        { accessToken: "pat-xxx", fetchFn },
      );
      expect(r.ok).toBe(true);
      expect(r.id).toBe("co-1");
    });
    it("rejects when domain is missing", async () => {
      const r = await pushCompanyToHubSpot({ name: "X" }, { accessToken: "pat-xxx", fetchFn: vi.fn() });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/domain/);
    });
  });

  describe("pushExtractionToHubSpot", () => {
    it("pushes the company and the contacts in the extraction's enrichments", async () => {
      const extraction = {
        page_title: "Acme",
        host: "acme.com",
        url: "https://acme.com",
        ai_summary: "Acme does X",
        enrichments: {
          contacts: { data: { people: [{ name: "Jane", email: "jane@acme.com", role: "CEO" }] } },
        },
      };
      const fetchFn = vi.fn()
        // company search → no match
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        // company create
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "co-1" }) })
        // contact search → no match
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        // contact create
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "c-1" }) });
      const r = await pushExtractionToHubSpot(extraction, { accessToken: "pat-xxx", fetchFn });
      expect(r.ok).toBe(true);
      expect(r.company.id).toBe("co-1");
      expect(r.contacts).toHaveLength(1);
      expect(r.counts.contacts_created).toBe(1);
    });
    it("returns counts=zero when there are no contacts to push", async () => {
      const extraction = { page_title: "X", host: "x.com", url: "https://x.com" };
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "co-1" }) });
      const r = await pushExtractionToHubSpot(extraction, { accessToken: "pat-xxx", fetchFn });
      expect(r.contacts).toEqual([]);
      expect(r.counts.contacts_attempted).toBe(0);
    });
    it("rejects when no access token is provided", async () => {
      const r = await pushExtractionToHubSpot({ url: "x", page_title: "x" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/HUBSPOT_ACCESS_TOKEN/);
    });
  });

  describe("DEFAULT_*_MAPPING exports", () => {
    it("exports the default contact and company mappings", () => {
      expect(DEFAULT_CONTACT_MAPPING.email).toBe("email");
      expect(DEFAULT_COMPANY_MAPPING.name).toBe("page_title");
    });
  });

  describe("_internal", () => {
    it("exposes the API base + helper", () => {
      expect(_internal.HUBSPOT_API_BASE).toBe("https://api.hubapi.com");
      expect(typeof _internal.collectPeopleFromEnrichments).toBe("function");
    });
  });
});
