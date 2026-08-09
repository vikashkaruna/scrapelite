// scripts/breadcrumb-migrate.mjs
// One-shot: add BreadcrumbList JSON-LD to existing nested pages that don't have it.
// Idempotent — safe to re-run; skips files that already have a BreadcrumbList.

import { readFileSync, writeFileSync } from "node:fs";

const PAGES = [
  {
    file: "public/vs/firecrawl/index.html",
    trail: [
      { name: "Home", item: "https://datiq.app/" },
      { name: "Compare", item: "https://datiq.app/vs/compare.html" },
      { name: "DatIQ vs Firecrawl", item: "https://datiq.app/vs/firecrawl" },
    ],
  },
  {
    file: "public/vs/apify.html",
    trail: [
      { name: "Home", item: "https://datiq.app/" },
      { name: "Compare", item: "https://datiq.app/vs/compare.html" },
      { name: "DatIQ vs Apify", item: "https://datiq.app/vs/apify.html" },
    ],
  },
  {
    file: "public/vs/phantombuster.html",
    trail: [
      { name: "Home", item: "https://datiq.app/" },
      { name: "Compare", item: "https://datiq.app/vs/compare.html" },
      { name: "DatIQ vs PhantomBuster", item: "https://datiq.app/vs/phantombuster.html" },
    ],
  },
  {
    file: "public/vs/compare.html",
    trail: [
      { name: "Home", item: "https://datiq.app/" },
      { name: "Compare", item: "https://datiq.app/vs/compare.html" },
    ],
  },
];

const BREADCRUMB_TEMPLATE = (trail) => {
  const items = trail
    .map(
      (t, i) =>
        `    {"@type": "ListItem", "position": ${i + 1}, "name": ${JSON.stringify(t.name)}, "item": ${JSON.stringify(t.item)}}`
    )
    .join(",\n");
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
${items}
  ]
}
</script>
`;
};

let touched = 0;
for (const { file, trail } of PAGES) {
  const before = readFileSync(file, "utf8");
  if (before.includes('"BreadcrumbList"')) {
    console.log(`skip: ${file} (already has BreadcrumbList)`);
    continue;
  }
  // Insert before the first <style> tag
  const idx = before.indexOf("<style>");
  if (idx === -1) {
    console.log(`warn: ${file} (no <style> tag found; appending to head instead)`);
  }
  const insertAt = idx === -1 ? before.indexOf("</head>") : idx;
  const after = before.slice(0, insertAt) + BREADCRUMB_TEMPLATE(trail) + before.slice(insertAt);
  writeFileSync(file, after);
  touched++;
  console.log(`updated: ${file}`);
}

console.log(`\nDone. ${touched} file(s) updated.`);
