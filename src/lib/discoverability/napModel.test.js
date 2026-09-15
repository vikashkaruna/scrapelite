import { describe, it, expect } from "vitest";
import {
  normaliseName, normalisePhone, normaliseAddress, normaliseAddressTokens, normalisePostal,
  MATCH_STATES, MATCH_STATE_IDS, matchField, NAP_FIELDS, NAP_FIELD_IDS,
  matchDirectory, napScore,
  LOCAL_FINDING_CODES, LOCAL_FINDING_CODE_IDS, localFindings,
  correctionPack, hasPlaceholders,
  serviceRadiusQueries, radiusCoverage,
} from "./napModel.js";
import { ROOT_CAUSES } from "./gapTaxonomy.js";
import { SOURCE_BY_ID } from "./directorySources.js";

// ── Normalisation is most of this module, because crying wolf is the failure ──
describe("normaliseName", () => {
  it("🔴 treats every legal form as the SAME name", () => {
    const forms = [
      "Acme Technologies Pvt Ltd", "Acme Technologies Pvt. Ltd.",
      "Acme Technologies Private Limited", "ACME TECHNOLOGIES LIMITED",
      "Acme Technologies LLP", "Acme Technologies, Inc.",
    ];
    for (const f of forms) expect(normaliseName(f), f).toBe("acme technologies");
  });

  it("strips a stacked suffix", () => {
    expect(normaliseName("Acme Technologies Pvt Ltd Co")).toBe("acme technologies");
  });

  it("does NOT strip a suffix that is part of the name", () => {
    // "Limited Edition Prints" is not "Edition Prints" with a legal form.
    expect(normaliseName("Limited Edition Prints")).toBe("limited edition prints");
  });

  it("returns an empty string for nothing, never null-ish surprises", () => {
    expect(normaliseName(null)).toBe("");
    expect(normaliseName("   ")).toBe("");
  });
});

describe("normalisePhone", () => {
  it("🔴 treats +91, 0-trunk and bare forms as ONE number", () => {
    const forms = ["+91 80 4718 2200", "0091-80-4718-2200", "08047182200", "80 4718 2200", "(080) 4718 2200"];
    for (const f of forms) expect(normalisePhone(f), f).toBe("8047182200");
  });

  it("only applies the 10-digit rule where the country declares it", () => {
    // Guessing a national length is how a correct US number becomes a mismatch.
    expect(normalisePhone("+1 415 555 0199", { country: "US" })).toBe("14155550199");
  });

  it("returns an empty string for nothing", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone(null)).toBe("");
  });
});

describe("normaliseAddress", () => {
  it("🔴 expands the abbreviations that make one address look like two", () => {
    expect(normaliseAddress("4th Flr, MG Rd, Opp. Metro Stn"))
      .toBe(normaliseAddress("4th Floor, MG Road, Opposite Metro Stn"));
  });

  it("drops noise words that carry no discrimination", () => {
    expect(normaliseAddressTokens("The Oberoi, at MG Road")).toEqual(["oberoi", "mg", "road"]);
  });

  it("normalises a postal code on digits alone", () => {
    expect(normalisePostal("560 001")).toBe("560001");
  });
});

// ── Per-field matching ──────────────────────────────────────────────────────
describe("matchField", () => {
  it("calls a byte-identical value exact, and a normalised one strong", () => {
    expect(matchField("name", "Acme Ltd", "Acme Ltd").state).toBe("exact");
    expect(matchField("name", "Acme Ltd", "Acme Private Limited").state).toBe("strong");
    expect(matchField("phone", "+91 80 4718 2200", "08047182200").state).toBe("strong");
    expect(matchField("address", "4th Floor MG Road", "4th Flr MG Rd").state).toBe("strong");
  });

  it("calls a genuinely different value a mismatch", () => {
    expect(matchField("name", "Acme Technologies", "Zenith Systems").state).toBe("mismatch");
    expect(matchField("phone", "+91 80 4718 2200", "+91 80 9999 0000").state).toBe("mismatch");
  });

  it("calls a partial address a weak match, not a mismatch", () => {
    const r = matchField("address", "4th Floor MG Road Bengaluru 560001", "MG Road Bengaluru");
    expect(r.state).toBe("weak");
  });

  it("🔴 a field the source never publishes is NOT_PUBLISHED, not a mismatch", () => {
    expect(matchField("address", "4th Floor MG Road", null, { published: false }).state).toBe("not_published");
  });

  it("🔴 a field the source leaves EMPTY is `absent`, and that is a different state", () => {
    // not_published is our knowledge of the source's format; absent is the
    // source having the field and leaving it blank. Only the second is
    // something the customer can act on.
    expect(matchField("phone", "+91 80 4718 2200", "").state).toBe("absent");
    expect(MATCH_STATES.absent.score).toBeNull();
    expect(MATCH_STATES.not_published.score).toBeNull();
  });

  it("🔴 blames NOBODY when we have no canonical value to compare against", () => {
    // Reporting a mismatch here would fault the customer's listing for a gap in
    // the truth record they were never asked to fill. LD-07 raises that instead.
    const r = matchField("address", null, "4th Floor MG Road");
    expect(r.state).toBe("not_published");
    expect(r.reason).toMatch(/no canonical value/);
  });

  it("every declared state has a score or an explicit null", () => {
    for (const id of MATCH_STATE_IDS) {
      const s = MATCH_STATES[id].score;
      expect(s === null || (typeof s === "number" && s >= 0 && s <= 100), id).toBe(true);
    }
  });
});

// ── Match_d ─────────────────────────────────────────────────────────────────
describe("matchDirectory — Match_d", () => {
  const canonical = {
    name: "Acme Technologies Pvt Ltd", address: "4th Floor, MG Road, Bengaluru",
    phone: "+91 80 4718 2200", postal_code: "560001",
  };

  it("scores a listing that differs only in formatting near the top", () => {
    const m = matchDirectory("justdial", canonical, {
      name: "Acme Technologies", address: "4th Flr, MG Rd, Bengaluru",
      phone: "08047182200", postal_code: "560 001",
    });
    expect(m.score).toBeGreaterThan(85);
    expect(m.mismatches).toEqual([]);
  });

  it("scores a listing with a wrong address well below one with a wrong postal code", () => {
    const wrongAddress = matchDirectory("justdial", canonical, { ...canonical, address: "12 Brigade Road, Mumbai" });
    const wrongPostal = matchDirectory("justdial", canonical, { ...canonical, postal_code: "400001" });
    expect(wrongAddress.score).toBeLessThan(wrongPostal.score);
  });

  it("🔴 REDISTRIBUTES the weight of a field the source cannot publish", () => {
    // G2 shows a name and nothing else. Scoring the three absent fields as 0
    // would report a perfectly correct G2 listing at 30.
    const m = matchDirectory("g2", canonical, { name: "Acme Technologies" });
    // The name matches after the legal form is set aside, so the score is the
    // strong-match value — NOT 0.30 x 92 diluted across three fields G2 has
    // never shown anyone.
    expect(m.score).toBe(MATCH_STATES.strong.score);
    expect(m.coverage).toBeCloseTo(NAP_FIELDS.name.weight, 10);
    expect(m.fields.filter((f) => f.state === "not_published").map((f) => f.field).sort())
      .toEqual(["address", "phone", "postal_code"]);
  });

  it("returns null — never 0 — when nothing on the listing was comparable", () => {
    const m = matchDirectory("justdial", canonical, {});
    expect(m.score).toBeNull();
  });

  it("carries the tier weight so the roll-up does not have to look it up", () => {
    expect(matchDirectory("google_business_profile", canonical, canonical).tierWeight).toBe(1);
  });

  it("returns null for an unknown source rather than scoring it", () => {
    expect(matchDirectory("nope", canonical, canonical)).toBeNull();
  });

  it("the NAP field weights sum to 1 and rank address above name", () => {
    const total = NAP_FIELD_IDS.reduce((s, f) => s + NAP_FIELDS[f].weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(NAP_FIELDS.address.weight).toBeGreaterThan(NAP_FIELDS.name.weight);
  });
});

// ── The roll-up ─────────────────────────────────────────────────────────────
describe("napScore", () => {
  const canonical = { name: "Acme", address: "MG Road", phone: "8047182200", postal_code: "560001" };
  const perfect = (id) => matchDirectory(id, canonical, canonical);

  it("🔴 EXCLUDES an unchecked source instead of scoring it 0", () => {
    // Under D5 most customers authorise nothing. A zero-for-unchecked rule
    // would open every local report near zero — a number about our connectors,
    // not about their business — then jump the day they connect one.
    const s = napScore([perfect("justdial")], ["justdial", "google_business_profile", "bing_places"]);
    expect(s.score).toBe(100);
    expect(s.coverage).toBeLessThan(1);
    expect(s.unchecked.sort()).toEqual(["bing_places", "google_business_profile"]);
    expect(s.checkedCount).toBe(1);
    expect(s.configuredCount).toBe(3);
  });

  it("weights a tier-1 disagreement more heavily than a tier-5 one", () => {
    const badTop = napScore(
      [matchDirectory("google_business_profile", canonical, { ...canonical, address: "Elsewhere Entirely" }), perfect("trustpilot")],
      ["google_business_profile", "trustpilot"]);
    const badBottom = napScore(
      [perfect("google_business_profile"), matchDirectory("trustpilot", canonical, { name: "Zenith Systems" })],
      ["google_business_profile", "trustpilot"]);
    expect(badTop.score).toBeLessThan(badBottom.score);
  });

  it("names the worst offender by AUTHORITY, not by how low it scored", () => {
    // Fixing tier 1 moves more than fixing five of tier 5; a list sorted any
    // other way buries the one that matters.
    const s = napScore([
      matchDirectory("google_business_profile", canonical, { ...canonical, phone: "+91 80 1111 1111" }),
      matchDirectory("trustpilot", canonical, { name: "Completely Different" }),
    ], ["google_business_profile", "trustpilot"]);
    expect(s.worstOffender.sourceId).toBe("google_business_profile");
  });

  it("separates a source that was not checked from one that was unreadable", () => {
    const s = napScore([matchDirectory("justdial", canonical, {})], ["justdial", "sulekha"]);
    expect(s.unreadable).toEqual(["justdial"]);
    expect(s.unchecked).toEqual(["sulekha"]);
  });

  it("returns a null score when nothing at all was checked", () => {
    const s = napScore([], ["justdial", "sulekha"]);
    expect(s.score).toBeNull();
    expect(s.coverage).toBe(0);
  });
});

// ── Findings ────────────────────────────────────────────────────────────────
describe("LD findings", () => {
  const canonical = { name: "Acme Technologies Pvt Ltd", address: "4th Floor MG Road Bengaluru", phone: "8047182200", postal_code: "560001" };

  it("every LD code names a root cause that actually exists", () => {
    // A code pointing at an invented bucket is a referral to nothing.
    for (const c of LOCAL_FINDING_CODE_IDS) {
      expect(ROOT_CAUSES, c).toHaveProperty(LOCAL_FINDING_CODES[c].rootCause);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(LOCAL_FINDING_CODE_IDS).size).toBe(LOCAL_FINDING_CODE_IDS.length);
  });

  it("raises LD-01 at critical severity for a tier-1 address disagreement", () => {
    const m = matchDirectory("google_business_profile", canonical, { ...canonical, address: "12 Brigade Road Mumbai" });
    const f = localFindings([m], { canonical });
    const ld1 = f.find((x) => x.code === "LD-01");
    expect(ld1).toBeTruthy();
    expect(ld1.severity).toBe("critical");
  });

  it("softens LD-01 below the top tiers rather than dropping it", () => {
    const m = matchDirectory("trustpilot", canonical, { ...canonical, name: "Acme" });
    // trustpilot publishes name only, so use a vertical source with an address
    const m2 = matchDirectory("practo", canonical, { ...canonical, address: "12 Brigade Road Mumbai" });
    const ld1 = localFindings([m2], { canonical }).find((x) => x.code === "LD-01");
    expect(ld1.severity).toBe("medium");
    expect(m).toBeTruthy();
  });

  it("🔴 a REGISTRY address difference is LD-05, not LD-01", () => {
    // A registered office is routinely not a shopfront. Reporting it as a NAP
    // mismatch sends a customer to amend a statutory filing to match a shop —
    // expensive, slow, and the wrong fix.
    const m = matchDirectory("mca", canonical, { ...canonical, address: "Flat 2 Residency Road Bengaluru" });
    const codes = localFindings([m], { canonical }).map((x) => x.code);
    expect(codes).toContain("LD-05");
    expect(codes).not.toContain("LD-01");
    expect(LOCAL_FINDING_CODES["LD-05"].severity).toBe("low");
  });

  it("raises LD-07 when there is no canonical address to compare against", () => {
    const f = localFindings([], { canonical: { name: "Acme" } });
    expect(f.map((x) => x.code)).toContain("LD-07");
  });

  it("does NOT raise LD-07 when the truth record has an address", () => {
    expect(localFindings([], { canonical }).map((x) => x.code)).not.toContain("LD-07");
  });

  it("raises LD-04 only for an unchecked TOP-tier source", () => {
    const top = localFindings([], { canonical, uncheckedTopTier: ["google_business_profile"] });
    expect(top.map((x) => x.code)).toContain("LD-04");
    const low = localFindings([], { canonical, uncheckedTopTier: ["trustpilot"] });
    expect(low.map((x) => x.code)).not.toContain("LD-04");
  });

  it("raises LD-08 for a listing that was read and states nothing", () => {
    const m = matchDirectory("justdial", canonical, { name: "" });
    expect(localFindings([m], { canonical }).map((x) => x.code)).toContain("LD-08");
  });

  it("raises NOTHING for a set of listings that all agree", () => {
    const ms = ["justdial", "sulekha"].map((id) => matchDirectory(id, canonical, canonical));
    expect(localFindings(ms, { canonical })).toEqual([]);
  });
});

// ── Correction packs ────────────────────────────────────────────────────────
describe("correctionPack", () => {
  const canonical = { name: "Acme Technologies Pvt Ltd", address: "4th Floor MG Road Bengaluru", phone: "8047182200", postal_code: "560001" };

  it("offers only the fields the source actually publishes", () => {
    const pack = correctionPack("g2", canonical);
    expect(Object.keys(pack.values)).toEqual(["name"]);
  });

  it("🔴 emits a TODO placeholder rather than inventing a missing value", () => {
    // These get pasted into a LIVE public listing. A plausible invented address
    // does not get reviewed, it gets published — and becomes one more
    // contradicting record.
    const pack = correctionPack("justdial", { name: "Acme" });
    expect(pack.values.address).toMatch(/^TODO:/);
    expect(hasPlaceholders(pack)).toBe(true);
  });

  it("reports no placeholders when the truth record is complete", () => {
    expect(hasPlaceholders(correctionPack("justdial", canonical))).toBe(false);
  });

  it("🔴 lists only what actually DIFFERS, not every field", () => {
    // A pack that says "change all four" when one is wrong invites a re-type of
    // three correct values, and re-typing is where the next drift comes from.
    const m = matchDirectory("justdial", canonical, { ...canonical, phone: "+91 80 9999 0000" });
    expect(correctionPack("justdial", canonical, m).changeFields).toEqual(["phone"]);
  });

  it("carries the source's own note through, where it has one", () => {
    expect(correctionPack("mca", canonical).note).toMatch(/registered office/i);
    expect(SOURCE_BY_ID.mca.tier).toBe("registry");
  });

  it("returns null for an unknown source", () => {
    expect(correctionPack("nope", canonical)).toBeNull();
    expect(hasPlaceholders(null)).toBe(false);
  });
});

// ── Service radius ──────────────────────────────────────────────────────────
describe("serviceRadiusQueries", () => {
  it("builds discovery, comparison and branded queries per area and category", () => {
    const { queries } = serviceRadiusQueries({
      categories: ["plumber"], serviceAreas: ["Koramangala"], brandName: "Acme",
    });
    expect(queries.map((q) => q.query)).toEqual([
      "plumber in Koramangala", "best plumber in Koramangala", "Acme Koramangala",
    ]);
  });

  it("omits the branded query when there is no brand name to use", () => {
    const { queries } = serviceRadiusQueries({ categories: ["plumber"], serviceAreas: ["Indiranagar"] });
    expect(queries.every((q) => q.intent !== "branded")).toBe(true);
  });

  it("🔴 builds NOTHING for a business that declared no service area, and says why", () => {
    // Inventing an area from the address would test a claim the customer never
    // made, then raise LD-06 when it failed.
    const r = serviceRadiusQueries({ categories: ["plumber"], serviceAreas: [] });
    expect(r.queries).toEqual([]);
    expect(r.reason).toMatch(/No service area/);
  });

  it("says so when there is no category to ask for", () => {
    const r = serviceRadiusQueries({ categories: [], serviceAreas: ["Koramangala"] });
    expect(r.queries).toEqual([]);
    expect(r.reason).toMatch(/No category/);
  });
});

describe("radiusCoverage", () => {
  it("names which declared areas no listing places the business near", () => {
    const r = radiusCoverage({
      serviceAreas: ["Koramangala", "Whitefield"],
      listingLocalities: ["Koramangala, Bengaluru"],
    });
    expect(r.covered).toEqual(["Koramangala"]);
    expect(r.uncovered).toEqual(["Whitefield"]);
    expect(r.coverage).toBeCloseTo(0.5, 10);
  });

  it("🔴 returns null coverage — never 0 — when no listing locality was read", () => {
    const r = radiusCoverage({ serviceAreas: ["Koramangala"], listingLocalities: [] });
    expect(r.coverage).toBeNull();
    expect(r.reason).toMatch(/could not be measured/);
  });

  it("says there is nothing to measure when no area was declared", () => {
    const r = radiusCoverage({ serviceAreas: [], listingLocalities: ["Koramangala"] });
    expect(r.coverage).toBeNull();
    expect(r.reason).toMatch(/No service area declared/);
  });
});
