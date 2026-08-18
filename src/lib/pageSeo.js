// src/lib/pageSeo.js — GENERATED ONCE, now hand-maintained.
//
// Extracted verbatim from the hand-written static pages under public/ at the
// point those URLs became React-owned (see scripts/site-routes.mjs). Keeping it
// as data rather than retyping it into ten components was a correctness call:
// the use-case pages carry full FAQPage schemas with real question/answer
// pairs, and transcribing those by hand is exactly how a rich result quietly
// disappears.
//
// Each React page passes its entry straight to useSeo(), and the prerenderer
// captures the result — so this is what Google actually reads.
//
// To change a page's title, description or schema, edit it HERE. The static
// HTML it came from is now generated output and any edit there is erased on
// the next `npm run prerender`.

export const PAGE_SEO = {
  "/pricing": {
    "title": "DatIQ Pricing — Free, Go, Select, Pro, Business, Agency | DatIQ.app",
    "description": "DatIQ pricing: Free (10 extractions/month), Go ($4.80/mo), Select ($14.40/mo), Pro ($20.40/mo, recommended), Business ($44.40/mo), Agency ($106.80/mo, best value), Developer ($32.40/mo, coming H3 2026). 20% off annual. INR pricing for India.",
    "canonical": "https://datiq.app/pricing",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "DatIQ",
        "alternateName": "DatIQ.app — The Unified Web Intelligence Platform",
        "description": "DatIQ is a no-code web intelligence platform. Paste any public URL and get headings, links, contacts, pricing, AI summaries, and custom fields in seconds.",
        "url": "https://datiq.app/pricing",
        "brand": {
          "@type": "Brand",
          "name": "DatIQ"
        },
        "offers": [
          {
            "@type": "Offer",
            "name": "Free",
            "price": "0",
            "priceCurrency": "USD",
            "description": "10 extractions/month, 25-trial credit, no credit card"
          },
          {
            "@type": "Offer",
            "name": "Go",
            "price": "4.80",
            "priceCurrency": "USD",
            "description": "200 extractions/month, CSV/PDF/Markdown export, email export"
          },
          {
            "@type": "Offer",
            "name": "Select",
            "price": "14.40",
            "priceCurrency": "USD",
            "description": "500 extractions/month, batch up to 50 URLs"
          },
          {
            "@type": "Offer",
            "name": "Pro",
            "price": "20.40",
            "priceCurrency": "USD",
            "description": "1000 extractions/month, scheduled monitoring, Google Sheets"
          },
          {
            "@type": "Offer",
            "name": "Business",
            "price": "44.40",
            "priceCurrency": "USD",
            "description": "10,000 extractions/month, API, 3 seats, HubSpot CRM sync, white-label PDF"
          },
          {
            "@type": "Offer",
            "name": "Agency",
            "price": "106.80",
            "priceCurrency": "USD",
            "description": "Unlimited extractions, 5 workspaces, priority support"
          },
          {
            "@type": "Offer",
            "name": "Developer",
            "price": "32.40",
            "priceCurrency": "USD",
            "description": "API-first, 10K row credits. Coming H3 2026"
          }
        ]
      }
    ]
  },
  "/about": {
    "title": "About DatIQ — the no-code web intelligence platform | DatIQ.app",
    "description": "DatIQ is a no-code web intelligence platform built on Pillar 0 — Web Intelligence Core. We turn any public URL into structured data: headings, links, contacts, pricing, AI summaries, custom fields. Free to start, no credit card.",
    "canonical": "https://datiq.app/about",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "name": "About DatIQ",
        "description": "DatIQ is a no-code web intelligence platform built on Pillar 0 — Web Intelligence Core. We turn any public URL into structured data.",
        "url": "https://datiq.app/about",
        "mainEntity": {
          "@type": "Organization",
          "name": "DatIQ",
          "url": "https://datiq.app",
          "logo": "https://datiq.app/favicon.svg",
          "description": "DatIQ is a no-code web intelligence platform. Pillar 0 — Web Intelligence Core — is the proven single, batch, and scheduled URL-extraction engine that the whole platform is built on."
        }
      }
    ]
  },
  "/contact": {
    "title": "Contact DatIQ — sales, support, and partnerships | DatIQ.app",
    "description": "Contact DatIQ — sales, support, billing, security, and partnerships. Most enquiries get a response within one business day. hello@datiq.app is our general inbox.",
    "canonical": "https://datiq.app/contact",
    "jsonLd": []
  },
  "/blog": {
    "title": "DatIQ Blog — guides on web data extraction, AI summarization, scraping | DatIQ.app",
    "description": "The DatIQ blog: product updates, use-case guides, and deep dives on no-code web data extraction, AI summarization, scheduled monitoring, custom extraction, and more. DatIQ.app is the no-code web intelligence platform.",
    "canonical": "https://datiq.app/blog",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "DatIQ Blog",
        "description": "Product updates, use-case guides, and deep dives on no-code web data extraction from the DatIQ team.",
        "url": "https://datiq.app/blog",
        "publisher": {
          "@type": "Organization",
          "name": "DatIQ",
          "logo": "https://datiq.app/favicon.svg"
        },
        "blogPost": [
          {
            "@type": "BlogPosting",
            "headline": "One-Click Push to HubSpot, Airtable, Notion, Slack, and Zapier",
            "datePublished": "2026-08-11",
            "url": "https://datiq.app/blog#one-click-integrations",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "DatIQ is Now an AI-Native Product: AEO/GEO/SEO Hardening + Customer Email Consolidation",
            "datePublished": "2026-08-09",
            "url": "https://datiq.app/blog#aeo-geo-seo-p1-sweep",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Introducing DatIQ: From URL to Intelligence in Seconds",
            "datePublished": "2026-06-09",
            "url": "https://datiq.app/blog#introducing-datiq",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Every Payment Now Has a Document: Invoices, Receipts, and a Kinder Way to Lapse",
            "datePublished": "2026-07-27",
            "url": "https://datiq.app/blog#invoices-receipts",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Set It and Know: Monitor Any Web Page for Changes with DatIQ Schedules",
            "datePublished": "2026-07-22",
            "url": "https://datiq.app/blog#monitor-any-page",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "How to Extract Competitor Pricing in 60 Seconds",
            "datePublished": "2026-06-05",
            "url": "https://datiq.app/blog#extract-competitor-pricing",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Lead Research at Scale: Surface Contacts from Any Domain",
            "datePublished": "2026-05-28",
            "url": "https://datiq.app/blog#lead-research-at-scale",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Domain Mapping: Discover Every URL on a Site",
            "datePublished": "2026-05-20",
            "url": "https://datiq.app/blog#domain-mapping",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Custom Extraction: Ask for Any Field in Plain English",
            "datePublished": "2026-05-12",
            "url": "https://datiq.app/blog#custom-extraction",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Persona-Adaptive Workflows: DatIQ Learns Your Role",
            "datePublished": "2026-05-03",
            "url": "https://datiq.app/blog#persona-adaptive",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          },
          {
            "@type": "BlogPosting",
            "headline": "Zero-Code Enrichment Pipeline: From URL to CRM in 5 Steps",
            "datePublished": "2026-04-22",
            "url": "https://datiq.app/blog#enrichment-pipeline",
            "author": {
              "@type": "Organization",
              "name": "DatIQ"
            }
          }
        ]
      }
    ]
  },
  "/integrations": {
    "title": "DatIQ Integrations — HubSpot, Notion, Airtable, Slack, webhooks | DatIQ.app",
    "description": "DatIQ integrations: CSV and PDF export, webhooks, HubSpot, Google Sheets, Slack, Airtable, Notion. Move extracted data into the tools your team already uses.",
    "canonical": "https://datiq.app/integrations",
    "jsonLd": []
  },
  "/use-cases": {
    "title": "DatIQ Use Cases — lead generation, competitor research, SEO audit, market research | DatIQ.app",
    "description": "DatIQ use cases: lead generation, competitor research, SEO audit, market research. Paste a URL — get structured intelligence. No setup, no code. Free to start.",
    "canonical": "https://datiq.app/use-cases",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "https://datiq.app/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Use cases",
            "item": "https://datiq.app/use-cases"
          }
        ]
      }
    ]
  },
  "/use-cases/lead-generation": {
    "title": "Lead Generation with DatIQ — extract contacts from any company URL",
    "description": "Turn any company website into a qualified prospect. Extract leadership contacts, emails, mission, and an AI brief in 30 seconds. No code, no setup, free to start.",
    "canonical": "https://datiq.app/use-cases/lead-generation",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "https://datiq.app/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Use cases",
            "item": "https://datiq.app/use-cases"
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": "Lead Generation",
            "item": "https://datiq.app/use-cases/lead-generation"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Lead Generation with DatIQ",
        "description": "Turn any company website into a qualified prospect. Extract leadership contacts, emails, mission, and an AI brief in 30 seconds.",
        "datePublished": "2026-08-08",
        "dateModified": "2026-08-09",
        "author": {
          "@type": "Organization",
          "name": "DatIQ"
        },
        "publisher": {
          "@type": "Organization",
          "name": "DatIQ",
          "logo": {
            "@type": "ImageObject",
            "url": "https://datiq.app/favicon.svg"
          }
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How do I extract a lead from a company website?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Paste the company URL into DatIQ, enable the 'Contacts & emails' toggle (or use the Quick Enrichment button on the preview), and the AI returns leadership names, titles, email addresses, and social profiles in seconds. Export the result as CSV or push directly to HubSpot, Airtable, Notion, Slack, or Zapier on Business and Agency plans."
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ find personal emails for individual prospects?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "DatIQ surfaces the contact information a company publishes publicly — leadership team pages, board pages, 'press contact' sections, and similar. We do not generate or guess personal emails; everything returned is what is on the public page. For personal email finding beyond published contacts, pair DatIQ with a dedicated email-finding tool like Hunter or Apollo."
            }
          },
          {
            "@type": "Question",
            "name": "How many leads can I extract per month?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The Free plan includes 10 extractions per month and a 25-trial credit. Select ($19/mo) is 100, Pro ($29/mo) is 250, Business ($79/mo) is 1,000, and Agency ($299/mo) is unlimited. You can also batch-process up to hundreds of URLs in a single run on Pro and above."
            }
          },
          {
            "@type": "Question",
            "name": "Can I push leads directly into HubSpot, Airtable, Notion, Slack, or Zapier?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Business and Agency plans include native one-click push to HubSpot, Airtable, Notion, Slack, and Zapier (server-stored connections, set up once in /account#integrations). One click on the Dashboard and the extracted contacts + company details are pushed to your CRM with the right field mapping. Pro plan supports Google Sheets export, which can be used as a staging layer."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/competitor-research": {
    "title": "Competitor Research with DatIQ — track pricing, messaging, and leadership",
    "description": "Monitor competitor pricing pages, feature changes, and leadership moves automatically. Get AI-summarised insights on what changed and why it matters. Scheduled monitoring, side-by-side comparison, CSV export.",
    "canonical": "https://datiq.app/use-cases/competitor-research",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "https://datiq.app/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Use cases",
            "item": "https://datiq.app/use-cases"
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": "Competitor Research",
            "item": "https://datiq.app/use-cases/competitor-research"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Competitor Research with DatIQ",
        "description": "Monitor competitor pricing, feature changes, and leadership moves automatically with scheduled monitoring and AI summaries.",
        "datePublished": "2026-08-08",
        "dateModified": "2026-08-09",
        "author": {
          "@type": "Organization",
          "name": "DatIQ"
        },
        "publisher": {
          "@type": "Organization",
          "name": "DatIQ",
          "logo": {
            "@type": "ImageObject",
            "url": "https://datiq.app/favicon.svg"
          }
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does DatIQ track competitor pricing changes?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Set up a Schedule (Pro and above) on any competitor's pricing or product page. Choose hourly, daily, weekly, or monthly cadence. DatIQ re-extracts the page on schedule, diffs the pricing tiers against the previous run, and emails you a digest of what changed. The dashboard shows the full change history per URL."
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ compare two competitors side by side?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. The Compare content-generation format takes two URLs and returns a battle card with pricing tiers, key features, target audience, and a strengths/weaknesses table per side. The /vs/battlecard static page generates a shareable battle card on demand."
            }
          },
          {
            "@type": "Question",
            "name": "How many competitors can I track?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "There is no hard cap on the number of URLs you can monitor. The limit is your plan's monthly extraction budget: Select 100, Pro 250, Business 1,000, Agency unlimited. A single recurring schedule re-runs every N hours/days, so a daily check of 10 competitors costs 300 extractions/month — well within Business."
            }
          },
          {
            "@type": "Question",
            "name": "Can I see when a competitor changes their homepage messaging?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Schedule a DatIQ extraction on the competitor's homepage with a custom prompt: 'Extract the H1, sub-headline, and three primary CTAs.' On every run, DatIQ returns the current text and highlights changes against the previous extraction. Useful for catching repositioning moves before they hit the press."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/seo-audit": {
    "title": "SEO Audit with DatIQ — H1→H6, link profile, content gaps in seconds",
    "description": "Audit any site's heading structure, internal and external link profile, and content gaps in seconds. No Screaming Frog required. Domain mapping for full-site audits. Export to CSV.",
    "canonical": "https://datiq.app/use-cases/seo-audit",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "https://datiq.app/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Use cases",
            "item": "https://datiq.app/use-cases"
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": "SEO Audit",
            "item": "https://datiq.app/use-cases/seo-audit"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "SEO Audit with DatIQ",
        "description": "Audit any site's heading structure, internal and external link profile, and content gaps in seconds.",
        "datePublished": "2026-08-08",
        "dateModified": "2026-08-09",
        "author": {
          "@type": "Organization",
          "name": "DatIQ"
        },
        "publisher": {
          "@type": "Organization",
          "name": "DatIQ",
          "logo": {
            "@type": "ImageObject",
            "url": "https://datiq.app/favicon.svg"
          }
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How do I audit a website's SEO with DatIQ?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Paste the homepage or any URL into DatIQ. The default extraction returns every heading H1 through H6, every internal and external link, the page title, meta description, OpenGraph tags, and an AI summary. Enable 'Map entire domain' to discover every URL on the site, then extract them in batch to see content gaps across the whole site."
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ find missing schema markup?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Use the custom extraction prompt: 'Extract every JSON-LD or Microdata block on the page, with its @type and the field names. Flag any @type that is missing required fields per schema.org.' The AI returns a structured report of present and missing schema, per page."
            }
          },
          {
            "@type": "Question",
            "name": "How do I audit an entire domain, not just one page?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Toggle 'Map entire domain' in the composer. DatIQ returns every crawlable URL on the site, then you can batch-extract them. Pro and above plans support batch URL processing. The full-site audit is one export to CSV."
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ replace Screaming Frog or Sitebulb?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "For most small-to-medium sites (up to ~10,000 URLs), DatIQ is faster to set up and significantly cheaper. For very large sites, Screaming Frog's desktop crawler is more efficient. DatIQ shines for content audits, AI summarisation, and one-off structural checks. Use both as needed."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/market-research": {
    "title": "Market Research with DatIQ — map your market landscape at machine speed",
    "description": "Aggregate pricing, missions, leadership, and product data from hundreds of company sites. Domain mapping for full coverage. Batch extraction. Scheduled quarterly sweeps. Export to JSON, CSV, or your data warehouse.",
    "canonical": "https://datiq.app/use-cases/market-research",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "https://datiq.app/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "Use cases",
            "item": "https://datiq.app/use-cases"
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": "Market Research",
            "item": "https://datiq.app/use-cases/market-research"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Market Research with DatIQ",
        "description": "Map your market landscape at machine speed — aggregate pricing, missions, leadership, and product data from hundreds of company sites.",
        "datePublished": "2026-08-08",
        "dateModified": "2026-08-09",
        "author": {
          "@type": "Organization",
          "name": "DatIQ"
        },
        "publisher": {
          "@type": "Organization",
          "name": "DatIQ",
          "logo": {
            "@type": "ImageObject",
            "url": "https://datiq.app/favicon.svg"
          }
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How do I do market research with DatIQ?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Build a list of 50-500 company URLs in your space. Use the Batch feature (Pro and above) to extract each one with a custom prompt: 'Extract company name, mission, pricing tiers, leadership team, and any custom field relevant to [your market].' DatIQ returns structured JSON for each, and exports a single CSV. Use the Explain content format to generate a market overview from the aggregated data."
            }
          },
          {
            "@type": "Question",
            "name": "How do I aggregate reviews from G2, Capterra, or App Store?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Paste the G2 or Capterra product page URL into DatIQ. The default extraction returns every review summary, rating, reviewer title, and date on the page. For deep extraction (hundreds of reviews), use the custom prompt: 'For every review on this page, extract: reviewer name, title, company, star rating, review date, and the full review text.'"
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ pull data into a spreadsheet or data warehouse?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. CSV export works on every plan. Google Sheets export is on Pro and above. The /api/extract endpoint returns JSON, which can be piped into Snowflake, BigQuery, or any warehouse via a scheduled Netlify Function. Business and Agency plans include webhook delivery on every extraction."
            }
          },
          {
            "@type": "Question",
            "name": "How often should I re-run a market sweep?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Quarterly is the default cadence for most teams — pricing pages change, leadership turns over, and product positioning shifts. Set up a Schedule on each company's homepage or pricing page with monthly cadence to catch material changes between sweeps. Pro and above plans support scheduled extraction."
            }
          }
        ]
      }
    ]
  }
};

/**
 * Look up a page's SEO block. Returns undefined for an unknown path, which
 * useSeo() handles by leaving the document head alone.
 */
export function seoFor(path) {
  return PAGE_SEO[path];
}
