// issueCatalog.js — every defect the engine can report, as stable data.
//
// PURE. Imported by the analysers (which raise codes), the recommendation
// engine (which turns them into work), the dashboard (which renders them) and
// the report writer (which explains them). One definition, four consumers.
//
// ── ISSUE CODES ARE A PUBLIC CONTRACT ──────────────────────────────────────
// Codes travel in the JSON payload, in webhook bodies, in stored rows and in
// every historical diff. "AC-02 was resolved" is only a true sentence if AC-02
// still means what it meant when the baseline was taken. Add codes freely;
// never repurpose one, and never renumber.
//
// ── WHY SEVERITY AND PRIORITY ARE DIFFERENT THINGS ─────────────────────────
// `severity` is how bad the defect is. Priority — computed later in
// recommendationModel.js — is how soon you should fix it, which also depends on
// effort and confidence. A critical issue that needs a three-month
// re-platforming is not the first thing anyone should do on Monday, and
// conflating the two produces a queue nobody can act on.

/** Ordered worst-first, so `SEVERITIES.indexOf` doubles as a sort key. */
export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);

/** Who is actually able to fix a thing. Drives queue filtering and assignment. */
export const OWNERS = Object.freeze([
  "content", "seo", "engineering", "brand", "product",
  "growth_cro", "product_marketing", "analytics", "local_ops", "design",
  "customer_success", "sales", "agency",
]);

export const FRAMEWORK_SCOPES = Object.freeze(["seo", "aeo", "geo", "common"]);

/**
 * The catalogue.
 *
 *   pillar       which pillar's score this depresses
 *   rootCause    WHAT KIND of problem this really is — see gapTaxonomy.js.
 *                46 individually-true findings is a list, not a diagnosis, and
 *                the reader's actual question is "what is wrong with this page".
 *   module       which DatIQ capability answers it. The referral, not the
 *                diagnosis; the two move independently.
 *   severity     how bad the defect is, independent of effort
 *   frameworks   which discipline(s) it hurts — drives the per-tab issue lists
 *   owner        who can fix it
 *   impact       0-100 estimated score lift if fixed (the engine refines this
 *                per audit from the actual signal gap; this is the prior)
 *   effort       0-100 estimated cost to fix, where 100 is hardest
 *   confidence   0-100 certainty that this reading is correct. Deterministic
 *                checks sit high; anything inferred by a model sits lower, and
 *                that is what stops a confident-sounding LLM guess from
 *                outranking a measured fact in the queue.
 *   title        the finding, as a sentence a non-specialist understands
 *   why          why it matters — shown in the report, not just the code
 *   fix          the shape of the remedy; the construct generator elaborates it
 *   asset        which ready-made construct to attach, if any
 *   penalty      the multiplicative blocker this issue triggers, if any.
 *
 * ── WHY `penalty` MATTERS TO THE QUEUE ─────────────────────────────────────
 * Without it the priority formula badly under-ranks hard blockers. A noindex
 * page recovers only 6.25 points of crawl_index_eligibility signal, which is
 * less than several content fixes — so "remove the noindex" sorted BELOW "add
 * an answer block" on a page nobody can index at all. The blocker's real worth
 * is not its signal share, it is the 0.20 multiplier it removes from the ENTIRE
 * score, and estimateLift() reads this field to price that in.
 */
export const ISSUES = Object.freeze({
  // ── Answer Clarity ───────────────────────────────────────────────────────
  "AC-01": {
    pillar: "answer_clarity", severity: "critical", frameworks: ["aeo", "geo"],
    owner: "content", impact: 85, effort: 25, confidence: 90,
    title: "The page never directly answers its own question",
    why: "Answer engines quote a passage, not a page. With no self-contained resolution to lift, there is nothing for them to cite even when the page ranks.",
    fix: "Add a 40-60 word direct answer immediately below the H1, before any narrative build-up.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-02": {
    pillar: "answer_clarity", severity: "high", frameworks: ["aeo", "geo"],
    owner: "content", impact: 60, effort: 30, confidence: 85,
    title: "Question headings open with context instead of an answer",
    why: "A section that starts with background gives an extractor no clean boundary, so the quotable sentence ends up mixed with setup it cannot use.",
    fix: "Lead each question heading with its answer, then expand underneath.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-03": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["aeo"],
    owner: "content", impact: 40, effort: 15, confidence: 90,
    title: "The primary answer is too long to be quoted whole",
    why: "Past roughly 200 words an answer stops being liftable, so an engine either truncates it — losing your qualifiers — or skips it.",
    fix: "Tighten the opening passage to 40-60 words and move the detail below it.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-04": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["aeo"],
    owner: "content", impact: 45, effort: 15, confidence: 85,
    title: "The primary answer is a fragment, not a self-contained answer",
    why: "A one-line stub reads as a heading rather than a resolution, so it is rarely selected as the answer to anything.",
    fix: "Expand the opening passage to a complete 40-60 word statement that stands on its own.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-05": {
    pillar: "answer_clarity", severity: "high", frameworks: ["aeo", "geo"],
    owner: "content", impact: 55, effort: 20, confidence: 88,
    title: "The answer is buried below the fold",
    why: "Answer-first placement is the most consistent recommendation in answer-engine guidance; a resolution halfway down competes with everything above it.",
    fix: "Move the direct answer above the fold, immediately under the H1.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-06": {
    pillar: "answer_clarity", severity: "high", frameworks: ["aeo", "geo"],
    owner: "content", impact: 55, effort: 25, confidence: 65,
    title: "The answer cannot stand alone when quoted",
    why: "Opening with 'this', 'it' or 'as mentioned above' makes the passage meaningless once lifted out of the page, so an engine that does quote it produces something incoherent.",
    fix: "Rewrite the passage so it names its subject explicitly and depends on nothing above it.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "answer_block",
  },
  "AC-07": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["aeo", "seo"],
    owner: "content", impact: 45, effort: 25, confidence: 85,
    title: "No headings are phrased as questions people actually ask",
    why: "Question headings are how a retrieval system matches a section to a query; statement headings force it to infer the match.",
    fix: "Rephrase the main section headings as the questions readers arrive with.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "heading_tree",
  },
  "AC-08": {
    pillar: "answer_clarity", severity: "low", frameworks: ["aeo"],
    owner: "content", impact: 30, effort: 20, confidence: 80,
    title: "Stepwise or comparative content is written as prose",
    why: "Answer engines lift ordered lists and comparison tables close to verbatim; the same content as a paragraph usually is not lifted at all.",
    fix: "Convert sequences to ordered lists and comparisons to a table.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "content_block",
  },

  // ── Entity Authority ─────────────────────────────────────────────────────
  "EA-01": {
    pillar: "entity_authority", severity: "high", frameworks: ["geo", "seo"],
    owner: "seo", impact: 65, effort: 20, confidence: 95,
    title: "No Organization schema identifies who publishes this",
    why: "Without machine-readable identity a model has no reliable way to connect this page to your brand, so citations land on whoever did declare it.",
    fix: "Add Organization JSON-LD with name, url, logo and sameAs.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: "jsonld_organization",
  },
  "EA-02": {
    pillar: "entity_authority", severity: "medium", frameworks: ["geo"],
    owner: "seo", impact: 40, effort: 15, confidence: 90,
    title: "Organization schema is missing key identity properties",
    why: "A partial entity record resolves ambiguously, which is close to not resolving at all when several brands share a name.",
    fix: "Complete the missing properties — typically logo, sameAs and a contact point.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: "jsonld_organization",
  },
  "EA-03": {
    pillar: "entity_authority", severity: "medium", frameworks: ["geo"],
    owner: "brand", impact: 45, effort: 10, confidence: 92,
    title: "No sameAs links to official profiles",
    why: "sameAs is the cheapest disambiguation signal there is: it is how a machine confirms that this brand and that profile are one entity.",
    fix: "Add sameAs entries for the profiles you actually control.",
    rootCause: "entity_ambiguity",
    module: "entity_graph",
    asset: "jsonld_organization",
  },
  "EA-04": {
    pillar: "entity_authority", severity: "high", frameworks: ["geo", "aeo"],
    owner: "content", impact: 55, effort: 20, confidence: 88,
    title: "The page has no named author",
    why: "Anonymous content is systematically treated as lower-trust, and trust is what decides which of several correct sources gets cited.",
    fix: "Add a visible byline and matching Person schema.",
    rootCause: "insufficient_proof",
    module: "trust_and_proof",
    asset: "jsonld_person",
  },
  "EA-05": {
    pillar: "entity_authority", severity: "medium", frameworks: ["geo"],
    owner: "content", impact: 40, effort: 30, confidence: 80,
    title: "The author has no bio page or visible credentials",
    why: "A name alone establishes nothing; the credential is what turns authorship into authority.",
    fix: "Link the byline to an author page carrying real credentials.",
    rootCause: "insufficient_proof",
    module: "trust_and_proof",
    asset: "author_bio",
  },
  "EA-06": {
    pillar: "entity_authority", severity: "medium", frameworks: ["geo", "seo"],
    owner: "content", impact: 40, effort: 10, confidence: 92,
    title: "No visible last-updated date",
    why: "Undated content is worse than openly old content, because a reader cannot even tell whether it is stale.",
    fix: "Show a published or last-updated date, and mirror it in dateModified.",
    rootCause: "insufficient_proof",
    module: "trust_and_proof",
    asset: "content_block",
  },
  "EA-07": {
    pillar: "entity_authority", severity: "low", frameworks: ["geo"],
    owner: "content", impact: 30, effort: 25, confidence: 70,
    title: "Claims are made without attribution",
    why: "Sourced claims are more citable, because citing you also lets the engine stand behind the underlying evidence.",
    fix: "Link statistics and factual claims to their primary sources.",
    rootCause: "insufficient_proof",
    module: "trust_and_proof",
    asset: null,
  },
  "EA-08": {
    pillar: "entity_authority", severity: "high", frameworks: ["geo"],
    owner: "brand", impact: 70, effort: 70, confidence: 75,
    title: "Answer engines never cite this domain",
    why: "Across the sampled prompts the brand was neither named nor cited, which is the outcome the whole entity-authority pillar exists to change.",
    fix: "Build canonical fact pages for the topics you want to own, and strengthen the entity signals feeding them.",
    rootCause: "entity_ambiguity",
    module: "ai_visibility",
    asset: "entity_card",
  },
  "EA-09": {
    pillar: "entity_authority", severity: "medium", frameworks: ["geo"],
    owner: "brand", impact: 50, effort: 55, confidence: 75,
    title: "The brand is mentioned but rarely cited as the source",
    why: "Being named is recognition; being cited is traffic and authority. The gap usually means the fact lives on somebody else's page.",
    fix: "Publish the canonical version of the facts you are being described with, so the citation has somewhere to land.",
    rootCause: "entity_ambiguity",
    module: "ai_visibility",
    asset: "entity_card",
  },
  "EA-10": {
    pillar: "entity_authority", severity: "medium", frameworks: ["seo", "geo"],
    owner: "seo", impact: 45, effort: 20, confidence: 88,
    title: "No schema describes what this page is",
    why: "Article, Product or WebSite markup is how a machine learns the page's type before reading a word of it.",
    fix: "Add the page-type schema that matches this template.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: "jsonld_article",
  },
  "EA-11": {
    pillar: "entity_authority", severity: "critical", frameworks: ["seo", "geo"],
    // High confidence: this is a structural reading of the markup, not a
    // judgement about it. Either the block names its entity or it does not.
    owner: "seo", impact: 65, effort: 15, confidence: 96,
    title: "Entity markup is present but cannot identify anything",
    why: "Declaring an entity and then not naming it is worse than declaring nothing: a resolver has a node to build and no identity to attach, which is how a page gets merged into the wrong knowledge-graph entry.",
    fix: "Give every entity block the property that names it — `name` on Organization, Person and Product, `headline` on Article — or remove the block until it can carry one.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: "jsonld_organization",
    penalty: "ENTITY_SCHEMA_INVALID",
  },

  // ── Structural Hierarchy ─────────────────────────────────────────────────
  "SH-01": {
    pillar: "structural_hierarchy", severity: "critical", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 70, effort: 10, confidence: 98,
    title: "The page has no H1",
    why: "The H1 is the page's declared subject. Without one, every downstream system has to guess.",
    fix: "Add a single H1 stating what the page is about.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "heading_tree",
  },
  "SH-02": {
    pillar: "structural_hierarchy", severity: "medium", frameworks: ["seo"],
    owner: "content", impact: 35, effort: 10, confidence: 95,
    title: "The page has more than one H1",
    why: "Competing H1s leave a machine choosing between subjects rather than reading one.",
    fix: "Keep one H1 and demote the rest to H2.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "heading_tree",
  },
  "SH-03": {
    pillar: "structural_hierarchy", severity: "medium", frameworks: ["seo", "aeo"],
    owner: "content", impact: 40, effort: 15, confidence: 70,
    title: "The H1 and the page title describe different things",
    why: "The two most important labels on the page disagree, which weakens both.",
    fix: "Align the H1 and title on one subject and one primary phrase.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "meta_tags",
  },
  "SH-04": {
    pillar: "structural_hierarchy", severity: "high", frameworks: ["aeo", "seo"],
    owner: "content", impact: 50, effort: 20, confidence: 95,
    title: "The heading hierarchy skips levels",
    why: "Retrieval systems chunk on the heading tree, so a skipped level merges two distinct sections and can separate a question from its answer.",
    fix: "Renumber the headings so each level follows its parent without gaps.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "heading_tree",
  },
  "SH-05": {
    pillar: "structural_hierarchy", severity: "low", frameworks: ["seo"],
    owner: "engineering", impact: 20, effort: 15, confidence: 90,
    title: "Empty headings are being used for styling",
    why: "A heading tag with no text adds a phantom node to the outline that means nothing to a parser.",
    fix: "Replace the styling-only heading tags with styled non-heading elements.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: null,
  },
  "SH-06": {
    pillar: "structural_hierarchy", severity: "high", frameworks: ["aeo", "seo"],
    owner: "seo", impact: 60, effort: 20, confidence: 92,
    title: "Visible FAQs carry no FAQPage schema",
    why: "The content is already there; the markup is what makes it eligible for direct extraction. This is usually the single cheapest AEO win on a page.",
    fix: "Add FAQPage JSON-LD whose wording matches the visible questions and answers exactly.",
    rootCause: "weak_page_structure",
    module: "schema_intelligence",
    asset: "jsonld_faq",
  },
  "SH-07": {
    penalty: "FAQ_SCHEMA_MISMATCH",
    pillar: "structural_hierarchy", severity: "critical", frameworks: ["aeo", "seo"],
    owner: "seo", impact: 65, effort: 20, confidence: 90,
    title: "FAQ markup describes text a reader cannot see",
    why: "Markup that misrepresents the page risks being ignored outright and, in the worst case, taken as a deliberate signal of bad faith.",
    fix: "Make the markup match the visible wording exactly, or remove the entries that are not on the page.",
    rootCause: "weak_page_structure",
    module: "schema_intelligence",
    asset: "jsonld_faq",
  },
  "SH-08": {
    pillar: "structural_hierarchy", severity: "medium", frameworks: ["aeo"],
    owner: "seo", impact: 45, effort: 20, confidence: 85,
    title: "Step-by-step content carries no HowTo schema",
    why: "Procedural markup is what makes an instruction sequence eligible for step-level extraction.",
    fix: "Add HowTo JSON-LD with a HowToStep per visible step.",
    rootCause: "weak_page_structure",
    module: "schema_intelligence",
    asset: "jsonld_howto",
  },
  "SH-09": {
    pillar: "structural_hierarchy", severity: "low", frameworks: ["seo"],
    owner: "seo", impact: 25, effort: 15, confidence: 90,
    title: "No BreadcrumbList schema",
    why: "Breadcrumbs tell a machine where this page sits in the site, which helps it judge topical context.",
    fix: "Add BreadcrumbList JSON-LD reflecting the real navigation path.",
    rootCause: "weak_page_structure",
    module: "schema_intelligence",
    asset: "jsonld_breadcrumb",
  },
  "SH-10": {
    pillar: "structural_hierarchy", severity: "critical", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 75, effort: 30, confidence: 98,
    title: "The page has no headings at all",
    why: "With no structure the entire page is one undifferentiated chunk, so nothing in it can be retrieved on its own.",
    fix: "Introduce a heading structure that segments the page into answerable sections.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "heading_tree",
  },
  "TA-18": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "engineering", impact: 30, effort: 10, confidence: 90,
    title: "Several technical fixes need doing in a particular order",
    why: "Some technical defects make other fixes inert until they are cleared \u2014 rewriting copy on a noindex page changes nothing \u2014 so the order the work happens in decides whether any of it counts.",
    fix: "Work the blocking items first, then the rest in priority order.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: "technical_brief",
  },
  "AC-09": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 55, effort: 45, confidence: 60,
    title: "The site publishes no comparison page we can find",
    why: "Comparison queries are high intent and are answered disproportionately by whoever published the comparison \u2014 including by answer engines, which cite a side-by-side far more readily than a product page.",
    fix: "Publish one comparison page per competitor you lose deals to, leading with the verdict.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "content_brief",
  },
  "AC-10": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 45, effort: 40, confidence: 60,
    title: "The site publishes no use-case page we can find",
    why: "A use-case page matches the job a reader is trying to finish rather than the product they have not chosen yet, which is the phrasing most searches actually use.",
    fix: "Publish a page per job your best customers hire you for, named as the outcome.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "content_brief",
  },
  "AC-11": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 35, effort: 40, confidence: 60,
    title: "The site publishes no industry page we can find",
    why: "Industry pages carry the constraints, vocabulary and proof a buyer in that sector checks for, none of which a general product page can hold at once.",
    fix: "Publish a page for each sector you already have customers in.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "content_brief",
  },
  "AC-12": {
    pillar: "answer_clarity", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "content", impact: 40, effort: 45, confidence: 60,
    title: "The site publishes no category page we can find",
    why: "A category page is the page that can rank for the plural, unbranded query \u2014 the one a reader types before they know which product they want.",
    fix: "Publish a category page that defines the space and names the options, including ones that are not yours.",
    rootCause: "missing_content_coverage",
    module: "recommendation_studio",
    asset: "content_brief",
  },
  "SH-11": {
    pillar: "structural_hierarchy", severity: "medium", frameworks: ["seo", "aeo"],
    owner: "content", impact: 35, effort: 15, confidence: 95,
    title: "Internal links use anchor text that describes clicking, not the destination",
    why: "Anchor text is one of the few signals that describes a page from the outside, so crawlers and retrieval systems both weight it \u2014 and \"click here\" describes nothing, leaving the target to be judged on its own content alone.",
    fix: "Replace each non-descriptive anchor with 2-5 words naming what the reader will find there.",
    rootCause: "weak_page_structure",
    module: "recommendation_studio",
    asset: "internal_links",
  },

  // ── Technical Accessibility ──────────────────────────────────────────────
  "TA-01": {
    penalty: "AI_CRAWLER_BLOCKED",
    pillar: "technical_accessibility", severity: "critical", frameworks: ["geo", "aeo"],
    owner: "engineering", impact: 90, effort: 10, confidence: 98,
    title: "AI crawlers are blocked by robots.txt",
    why: "The crawlers that feed answer engines are refused, so this page cannot be cited by them at any quality of content. Nothing else in this audit matters until this is deliberate or removed.",
    fix: "Permit GPTBot, ClaudeBot, PerplexityBot and Google-Extended if citation is the goal.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: "robots_txt",
  },
  "TA-02": {
    penalty: "AI_CRAWLER_PARTIAL_BLOCK",
    pillar: "technical_accessibility", severity: "medium", frameworks: ["geo"],
    owner: "engineering", impact: 50, effort: 10, confidence: 95,
    title: "Some AI crawlers are blocked while others are allowed",
    why: "Uneven access produces uneven citation: you appear in some assistants and are invisible in others, for no editorial reason.",
    fix: "Make the robots policy deliberate and consistent across the answer-engine crawlers.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: "robots_txt",
  },
  "TA-03": {
    penalty: "NOINDEX",
    pillar: "technical_accessibility", severity: "critical", frameworks: ["seo", "aeo", "geo"],
    owner: "engineering", impact: 95, effort: 5, confidence: 99,
    title: "The page is marked noindex",
    why: "The page explicitly asks not to be indexed. If that is not intentional it is the only thing worth fixing today.",
    fix: "Remove the noindex directive if the page is meant to be found.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-04": {
    pillar: "technical_accessibility", severity: "critical", frameworks: ["seo", "aeo", "geo"],
    owner: "engineering", impact: 95, effort: 20, confidence: 99,
    title: "The page does not return a 200",
    why: "A non-200 response is not indexed and not cited, whatever a browser happens to render.",
    fix: "Return 200 for the canonical address of this page.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-05": {
    penalty: "CANONICAL_TARGET_BROKEN",
    pillar: "technical_accessibility", severity: "critical", frameworks: ["seo"],
    owner: "engineering", impact: 80, effort: 15, confidence: 92,
    title: "The canonical URL does not resolve",
    why: "Indexing signals are being consolidated onto an address that is not there, so they are being thrown away.",
    fix: "Point the canonical at a URL that returns 200 — usually this page itself.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-06": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo"],
    owner: "engineering", impact: 40, effort: 10, confidence: 90,
    title: "No canonical URL is declared",
    why: "Without a canonical, query strings and variants can split one page's signals across several addresses.",
    fix: "Add a self-referencing canonical link.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-07": {
    penalty: "CONTENT_HYDRATION_ONLY",
    pillar: "technical_accessibility", severity: "critical", frameworks: ["aeo", "geo", "seo"],
    owner: "engineering", impact: 90, effort: 70, confidence: 90,
    title: "The content only exists after JavaScript runs",
    why: "Several answer-engine crawlers do not execute JavaScript. To them this page is blank, however good it looks in a browser.",
    fix: "Server-render or pre-render the primary content so it is present in the raw HTML.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-08": {
    pillar: "technical_accessibility", severity: "high", frameworks: ["aeo", "seo"],
    owner: "engineering", impact: 60, effort: 55, confidence: 85,
    title: "A significant share of the content is missing without JavaScript",
    why: "A non-rendering crawler sees a materially thinner page than your readers do, and judges it on that.",
    fix: "Move the primary content into the server-rendered HTML; leave enhancement to the client.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
  },
  "TA-09": {
    pillar: "technical_accessibility", severity: "high", frameworks: ["seo"],
    owner: "engineering", impact: 55, effort: 50, confidence: 90,
    title: "Largest Contentful Paint is above the good threshold",
    why: "LCP is a ranking input and a real abandonment driver; the two compound.",
    fix: "Reduce the largest element's load cost — usually a hero image or a render-blocking resource.",
    rootCause: "ux_friction",
    module: "technical_remediation",
    asset: null,
  },
  "TA-10": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo"],
    owner: "engineering", impact: 40, effort: 55, confidence: 88,
    title: "Interaction to Next Paint is above the good threshold",
    why: "Slow interaction response is measured in the field and counts against the page.",
    fix: "Break up long tasks and defer non-critical JavaScript.",
    rootCause: "ux_friction",
    module: "technical_remediation",
    asset: null,
  },
  "TA-11": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo"],
    owner: "engineering", impact: 40, effort: 30, confidence: 90,
    title: "Cumulative Layout Shift is above the good threshold",
    why: "Content that jumps while loading is both a ranking negative and the most-complained-about reading experience there is.",
    fix: "Reserve space for images, ads and late-loading embeds.",
    rootCause: "ux_friction",
    module: "technical_remediation",
    asset: null,
  },
  "TA-12": {
    penalty: "MOBILE_PARITY_MISSING",
    pillar: "technical_accessibility", severity: "high", frameworks: ["seo"],
    owner: "engineering", impact: 55, effort: 10, confidence: 95,
    title: "No viewport declaration for mobile",
    why: "Crawling is mobile-first, so the mobile rendering is the one that is judged.",
    fix: "Add a responsive viewport meta tag.",
    rootCause: "ux_friction",
    module: "technical_remediation",
    asset: null,
  },
  "TA-13": {
    pillar: "technical_accessibility", severity: "high", frameworks: ["seo", "aeo"],
    owner: "engineering", impact: 60, effort: 15, confidence: 98,
    title: "Structured data does not parse",
    why: "Malformed JSON-LD is discarded whole, so every signal it was carrying is lost silently.",
    fix: "Fix the JSON syntax so the block parses.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: null,
  },
  "TA-14": {
    pillar: "technical_accessibility", severity: "high", frameworks: ["seo", "aeo"],
    owner: "seo", impact: 55, effort: 20, confidence: 82,
    title: "Structured data describes content that is not visible",
    why: "Markup is expected to represent what a reader sees; describing absent content risks the markup being disregarded.",
    fix: "Bring the markup and the visible page back into agreement.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: null,
  },
  "TA-15": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo", "aeo", "geo"],
    owner: "seo", impact: 50, effort: 25, confidence: 95,
    title: "The page has no structured data at all",
    why: "Structured data is the cheapest way to state explicitly what a machine would otherwise have to infer.",
    fix: "Add the schema types that match this page's purpose.",
    rootCause: "entity_ambiguity",
    module: "schema_intelligence",
    asset: "jsonld_article",
  },
  "TA-16": {
    pillar: "technical_accessibility", severity: "medium", frameworks: ["seo", "geo"],
    owner: "engineering", impact: 35, effort: 10, confidence: 85,
    title: "robots.txt could not be fetched",
    why: "When crawl policy cannot be read, crawler behaviour becomes unpredictable and this audit has to assume rather than verify.",
    fix: "Serve a reachable robots.txt at the domain root.",
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: "robots_txt",
  },
  "TA-17": {
    pillar: "technical_accessibility", severity: "critical", frameworks: ["seo", "aeo", "geo"],
    // Effort is high and impact is real: this is rarely a one-line fix, and
    // the priority formula is meant to reflect that rather than putting a
    // re-platforming job at the top of Monday's queue.
    owner: "engineering", impact: 60, effort: 65, confidence: 90,
    title: "Core Web Vitals are severely failing",
    why: "Past a point, slowness stops being an experience problem and starts being a discovery one: crawl budget contracts and the page competes from behind on every query.",
    fix: "Treat this as a performance workstream, not a tweak — start with the metric furthest past its threshold and measure again from field data, not the lab.",
    // null, like every other performance code. There is no snippet that makes
    // a page fast, and offering one would be the placeholder-vs-invention rule
    // broken in the other direction.
    rootCause: "technical_access",
    module: "technical_remediation",
    asset: null,
    penalty: "SEVERE_CWV_FAILURE",
  },
});

export const ISSUE_CODES = Object.freeze(Object.keys(ISSUES));

/** Sort key: worst severity first, then bigger impact first. Stable. */
export function compareIssues(a, b) {
  const s = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  if (s !== 0) return s;
  return (b.impact || 0) - (a.impact || 0);
}

export function issuesForPillar(pillar) {
  return ISSUE_CODES.filter((c) => ISSUES[c].pillar === pillar);
}

/** Issues affecting one framework view. "common" issues appear in every tab. */
export function issuesForFramework(framework) {
  return ISSUE_CODES.filter((c) => {
    const f = ISSUES[c].frameworks;
    return f.includes(framework) || f.includes("common");
  });
}

/**
 * Count issues by severity — the dashboard's severity matrix, and the number
 * the report leads with.
 */
export function severityTally(issues = []) {
  const t = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const i of issues) if (t[i.severity] !== undefined) t[i.severity] += 1;
  return t;
}
