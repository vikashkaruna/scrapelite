// src/lib/engagement/syncConnectors.test.js
import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizePhone,
  splitName,
  dedupeProspects,
  mapGoogleSheetRowsToProspects,
  mapAirtableRecordsToProspects,
  mapDatIQExtractionsToProspects,
} from "./syncConnectors.js";

describe("syncConnectors — normalization & deduplication", () => {
  it("normalizes emails and phone numbers", () => {
    expect(normalizeEmail("  John.Doe@ACME.COM ")).toBe("john.doe@acme.com");
    expect(normalizeEmail("invalid-email")).toBe(null);

    expect(normalizePhone("+1 (555) 019-2834")).toBe("+15550192834");
    expect(normalizePhone("123")).toBe(null);
  });

  it("splits full names into first and last name components", () => {
    expect(splitName("Jane Doe")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(splitName("Cher")).toEqual({ first_name: "Cher", last_name: null });
    expect(splitName("Dr. Martin Luther King Jr.")).toEqual({ first_name: "Dr.", last_name: "Martin Luther King Jr." });
  });

  it("deduplicates incoming prospects against existing campaign records", () => {
    const existing = [
      { email: "alice@acme.test", phone: "+15551112222" },
      { email: "bob@acme.test", phone: "+15553334444" },
    ];

    const incoming = [
      { first_name: "Alice", email: "ALICE@acme.test", company: "Acme" }, // dup email
      { first_name: "Charlie", email: "charlie@acme.test", phone: "+1 (555) 333-4444" }, // dup phone
      { first_name: "David", email: "david@acme.test", phone: "+15557778888" }, // unique
      { first_name: "David 2", email: "david@acme.test" }, // intra-batch dup
    ];

    const { unique, duplicates, stats } = dedupeProspects(incoming, existing);
    expect(unique.length).toBe(1);
    expect(unique[0].first_name).toBe("David");
    expect(duplicates.length).toBe(3);
    expect(stats.total).toBe(4);
    expect(stats.uniqueCount).toBe(1);
    expect(stats.dupCount).toBe(3);
  });
});

describe("syncConnectors — platform mapping", () => {
  it("maps Google Sheet rows to structured prospects", () => {
    const rows = [
      {
        "Full Name": "Alice Smith",
        "Work Email": "alice@smith.test",
        "Phone": "+15551234567",
        "Company": "Smith Tech",
        "Title": "CTO",
      },
    ];

    const mapped = mapGoogleSheetRowsToProspects(rows, {
      name: "Full Name",
      email: "Work Email",
      role: "Title",
    });

    expect(mapped[0].first_name).toBe("Alice");
    expect(mapped[0].last_name).toBe("Smith");
    expect(mapped[0].email).toBe("alice@smith.test");
    expect(mapped[0].role).toBe("CTO");
    expect(mapped[0].source).toBe("google_sheets");
  });

  it("maps Airtable records to structured prospects", () => {
    const records = [
      {
        id: "rec123",
        fields: {
          "Name": "Bob Miller",
          "Email": "bob@miller.test",
          "Company": "Miller Logistics",
          "Role": "VP Operations",
        },
      },
    ];

    const mapped = mapAirtableRecordsToProspects(records);
    expect(mapped[0].first_name).toBe("Bob");
    expect(mapped[0].last_name).toBe("Miller");
    expect(mapped[0].email).toBe("bob@miller.test");
    expect(mapped[0].source_id).toBe("rec123");
    expect(mapped[0].source).toBe("airtable");
  });

  it("maps DatIQ web extractions directly to prospects", () => {
    const extraction = {
      id: "ext_456",
      url: "https://acme.test",
      page_title: "Acme Corp | Enterprise Analytics",
      ai_summary: "Acme builds enterprise reporting software.",
      enrichments: {
        contacts: {
          data: {
            contacts: [
              { name: "Carol Danvers", email: "carol@acme.test", role: "CEO", linkedin: "https://linkedin.com/in/carol" },
            ],
          },
        },
      },
    };

    const prospects = mapDatIQExtractionsToProspects(extraction);
    expect(prospects.length).toBe(1);
    expect(prospects[0].first_name).toBe("Carol");
    expect(prospects[0].last_name).toBe("Danvers");
    expect(prospects[0].email).toBe("carol@acme.test");
    expect(prospects[0].company).toBe("Acme Corp");
    expect(prospects[0].role).toBe("CEO");
    expect(prospects[0].source).toBe("datiq_extraction");
  });
});
