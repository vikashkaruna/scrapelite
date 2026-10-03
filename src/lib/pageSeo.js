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
    "description": "DatIQ pricing, in one unit — credits. Free (500 credits, one-time), Go ($5/mo · ₹449, 1,500), Select ($15/mo · ₹1,449, 5,000), Pro ($25/mo · ₹2,449, 10,000, recommended), Business ($85/mo · ₹7,849, 50,000), Agency ($200/mo · ₹19,449, 150,000 fair use, best value), Developer ($55/mo · ₹5,449, 25,000, upcoming). Credit packs from $5. Cheaper on annual billing. INR is a set price, not a conversion.",
    "canonical": "https://datiq.app/pricing",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "DatIQ",
        "alternateName": "DatIQ.app — The Unified Web Intelligence Platform",
        "description": "DatIQ is an AI-enabled web intelligence platform. Paste any public URL and get headings, links, contacts, pricing, AI summaries, and custom fields in seconds.",
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
            "description": "500 credits (one-time), export in every format, no credit card"
          },
          {
            "@type": "Offer",
            "name": "Go",
            "price": "5",
            "priceCurrency": "USD",
            "description": "1,500 credits/month, CSV import, 2 scheduled monitors"
          },
          {
            "@type": "Offer",
            "name": "Select",
            "price": "15",
            "priceCurrency": "USD",
            "description": "5,000 credits/month, batch up to 50 URLs"
          },
          {
            "@type": "Offer",
            "name": "Pro",
            "price": "25",
            "priceCurrency": "USD",
            "description": "10,000 credits/month, scheduled monitoring, Google Sheets"
          },
          {
            "@type": "Offer",
            "name": "Business",
            "price": "85",
            "priceCurrency": "USD",
            "description": "50,000 credits/month, API, 3 seats, HubSpot CRM sync, white-label PDF"
          },
          {
            "@type": "Offer",
            "name": "Agency",
            "price": "200",
            "priceCurrency": "USD",
            "description": "Unlimited extractions, 5 workspaces, priority support"
          },
          {
            "@type": "Offer",
            "name": "Developer",
            "price": "55",
            "priceCurrency": "USD",
            "description": "API-first, 10K row credits. Upcoming"
          }
        ]
      }
    ]
  },
  "/about": {
    "title": "About DatIQ — the AI-enabled web intelligence platform | DatIQ.app",
    "description": "DatIQ turns any public URL into structured, ready-to-use intelligence for sales, research, marketing, recruiting, and operations teams. No code, no setup, free to start.",
    "canonical": "https://datiq.app/about",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "name": "About DatIQ",
        "description": "DatIQ turns public web pages into structured, ready-to-use intelligence for sales, research, marketing, recruiting, and operations teams.",
        "url": "https://datiq.app/about",
        "mainEntity": {
          "@type": "Organization",
          "name": "DatIQ",
          "url": "https://datiq.app",
          "logo": "https://datiq.app/favicon.svg",
          "description": "DatIQ helps teams find, understand, enrich, and act on public web information without code."
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
    "description": "The DatIQ blog: product updates, use-case guides, and deep dives on AI-enabled web data extraction, AI summarization, scheduled monitoring, custom extraction, and more. DatIQ.app is the AI-enabled web intelligence platform.",
    "canonical": "https://datiq.app/blog",
    "jsonLd": [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "DatIQ Blog",
        "description": "Product updates, use-case guides, and deep dives on AI-enabled web data extraction from the DatIQ team.",
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
            "headline": "AI-Enabled Enrichment Pipeline: From URL to CRM in 5 Steps",
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
              "text": "Every feature spends from one pool of credits, so there is no separate extraction, audit or enrichment allowance to reason about. 1 credit is one page fetch; a Discoverability audit is 19, a deep AI call 5, a fast one 2, an enrichment 3. The Free plan includes 500 credits, granted once and never resetting. Go ($5/mo · ₹449) is 1,500, Select ($15/mo · ₹1,449) is 5,000, Pro ($25/mo · ₹2,449) is 10,000, Business ($85/mo · ₹7,849) is 50,000, and Agency ($200/mo · ₹19,449) is 150,000 on fair use. Unused plan credits roll over for one month, so you can hold at most two months' worth. Annual billing is cheaper again, and USD and INR are set prices rather than conversions of one another. Credit packs — 750 for $5 / ₹490, 3,000 for $19 / ₹1,849, 15,000 for $89 / ₹8,749 — top up any plan and never expire. You can also batch-process up to 500 URLs in a single run, and enrich and ICP-score bulk account lists of up to 500 rows on Agency."
            }
          },
          {
            "@type": "Question",
            "name": "Can I push leads directly into HubSpot, Airtable, Notion, Slack, or Zapier?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Integrations are included from the Select plan upwards: one-click push to HubSpot, Notion, Airtable and Slack, with each connection set up once under Account. Google Sheets export needs no connection and is available to everyone. From Select you can also build signal routing rules that push an account crossing your ICP threshold straight into Slack, an inbox, a webhook or HubSpot without anyone clicking anything."
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
              "text": "Two separate things bound this. Your plan grants a number of monitor SLOTS — 1 on Free, 2 on Go, 5 on Select, 10 on Pro, 25 on Business, 100 on Agency — and each run then spends credits from your pool at 1 credit per page read. A single recurring schedule re-runs every N hours/days, so a daily check of 10 competitors costs about 300 credits a month, comfortably inside Pro's 10,000. An add-on buys the slot; the running still costs credits."
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
              "text": "Yes. CSV export works on every plan. Google Sheets export is on Pro and above. The /api/extract endpoint returns JSON, which can be piped into Snowflake, BigQuery, or any warehouse via a scheduled Netlify Function. Business and Agency plans include webhook delivery on every extraction. Exporting and sharing are free — they spend no credits, because credits meter what costs us money to run, not what you do with the result."
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
  },
  "/use-cases/account-intelligence": {
    "title": "Bulk Account Intelligence with DatIQ - enrich and ICP-score company lists",
    "description": "Import up to 500 company domains, enrich each from their public site, score them against ICP rules you control, and export or push a prioritised account table. Every field carries its source.",
    "canonical": "https://datiq.app/use-cases/account-intelligence",
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
            "name": "Account Intelligence",
            "item": "https://datiq.app/use-cases/account-intelligence"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Account Intelligence",
        "description": "Import up to 500 company domains, enrich each from their public site, score them against ICP rules you control, and export or push a prioritised account table. Every field carries its source.",
        "datePublished": "2026-09-04",
        "dateModified": "2026-09-04",
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
            "name": "How do I enrich a list of company domains?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Open Lists in DatIQ, paste your domains or upload a CSV, and run the enrichment. DatIQ normalises and de-duplicates the list on import, reads each company's public site for firmographics, pricing model, positioning and contacts, and returns a table you can export as CSV or JSON or push to HubSpot, Notion, Airtable or Slack."
            }
          },
          {
            "@type": "Question",
            "name": "How does DatIQ score an account against my ICP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "You define the ICP as weighted criteria - a field, an operator, a value and a weight - and set a qualification threshold, 50 by default. Criteria can be marked required, in which case failing one disqualifies the account regardless of its other scores. You can test the whole rule set against a sample domain before running the list."
            }
          },
          {
            "@type": "Question",
            "name": "What happens if DatIQ cannot find a field for a company?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The field is marked absent rather than filled with a default, and the criterion that depended on it is excluded from the score with its weight redistributed across the criteria that were measured. It is never scored as zero. Every score therefore travels with a coverage figure showing how much of the picture it was computed from."
            }
          },
          {
            "@type": "Question",
            "name": "How many accounts can I put in one list?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A bulk list has its own size limit, separate from batch mode: 1 row on Free, 20 on Go, 50 on Select, 100 on Pro, 200 on Developer, 250 on Business, and 500 on Agency — that is how many rows fit in one run. Each enriched row then costs 3 credits from your pool. Everything is priced in one unit: credits. 1 credit = one page fetch; a Discoverability audit is 19. Free includes 500 credits, one-time and never resetting, with no credit card. Paid plans start at $5 / ₹449 a month (Go, 1,500 credits). Select is $15 / ₹1,449 (5,000), Pro $25 / ₹2,449 (10,000), Business $85 / ₹7,849 (50,000) and Agency $200 / ₹19,449 (150,000 on fair use). USD and INR are set prices, not conversions of one another. Annual billing is cheaper again. Credit packs top up any plan and never expire, and a plan's price and limits are fixed for the period you bought."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/competitive-monitoring": {
    "title": "Competitor Monitoring with DatIQ - pricing and positioning change alerts",
    "description": "Watch competitor pricing, features and positioning on a cadence. DatIQ classifies how much each change matters and routes the ones that do to Slack, email, a webhook or your CRM.",
    "canonical": "https://datiq.app/use-cases/competitive-monitoring",
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
            "name": "Competitive Monitoring",
            "item": "https://datiq.app/use-cases/competitive-monitoring"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Competitive Monitoring",
        "description": "Watch competitor pricing, features and positioning on a cadence. DatIQ classifies how much each change matters and routes the ones that do to Slack, email, a webhook or your CRM.",
        "datePublished": "2026-09-04",
        "dateModified": "2026-09-04",
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
            "name": "How do I monitor a competitor's pricing page for changes?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Create a watchlist, add the competitor domains and choose a cadence. DatIQ re-reads the pages on that schedule, compares each reading against the last, and classifies the difference. Pricing and tier changes are treated as critical and alert immediately."
            }
          },
          {
            "@type": "Question",
            "name": "Will I get an alert for every trivial change?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. Every change is classified by materiality. Critical changes such as a price or tier change alert immediately, high-materiality changes such as a positioning shift are batched daily, medium changes weekly, and low-materiality noise such as whitespace or a copyright year is recorded but never alerted on. The first run of a watchlist is a baseline and never alerts at all."
            }
          },
          {
            "@type": "Question",
            "name": "Does DatIQ tell me if a competitor removed something?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Only when it can tell the difference between a removal and a failed reading. If a pricing table was readable last week and is not today, DatIQ reports it as unobserved rather than deleted, because the far more common cause is a page that failed to render. A false claim that a competitor deleted their pricing is the most expensive mistake this category can make."
            }
          },
          {
            "@type": "Question",
            "name": "Where do the alerts go?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A signal routing rule sends them to Slack, email, a webhook or HubSpot, with conditions you set - for example, only changes at high materiality or above. Every dispatch is recorded whether it succeeded or not, and an unreachable destination is retried rather than dropped. Watchlists use your plan's scheduled-monitoring allowance, which starts on Select. Everything is priced in one unit: credits. 1 credit = one page fetch; a Discoverability audit is 19. Free includes 500 credits, one-time and never resetting, with no credit card. Paid plans start at $5 / ₹449 a month (Go, 1,500 credits). Select is $15 / ₹1,449 (5,000), Pro $25 / ₹2,449 (10,000), Business $85 / ₹7,849 (50,000) and Agency $200 / ₹19,449 (150,000 on fair use). USD and INR are set prices, not conversions of one another. Annual billing is cheaper again. Credit packs top up any plan and never expire, and a plan's price and limits are fixed for the period you bought."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/ai-visibility": {
    "title": "AI Visibility with DatIQ - how answer engines describe you vs competitors",
    "description": "Score your site and up to four competitors for classic search, answer engines and generative engines under one shared schema, and get a prioritised, evidence-backed brief on what to change first.",
    "canonical": "https://datiq.app/use-cases/ai-visibility",
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
            "name": "AI Visibility",
            "item": "https://datiq.app/use-cases/ai-visibility"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "AI Visibility",
        "description": "Score your site and up to four competitors for classic search, answer engines and generative engines under one shared schema, and get a prioritised, evidence-backed brief on what to change first.",
        "datePublished": "2026-09-04",
        "dateModified": "2026-09-04",
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
            "name": "What is AEO and GEO, and how are they different from SEO?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "SEO is optimising to win a ranked link in a classic search result. AEO is answer engine optimisation - being the source an assistant quotes when it answers a question directly. GEO is generative engine optimisation - being represented accurately in text a model generates. DatIQ scores all three separately, because the things that win a blue link are not the same as the things that win a citation."
            }
          },
          {
            "@type": "Question",
            "name": "How does DatIQ compare me to my competitors fairly?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Your site and up to four competitors are read with the same extraction schema, so the comparison is like-for-like. Four differently-shaped summaries are not a comparison. A competitor whose site could not be read is explicitly named as unread and passed to the model as NOT READ, so no row is invented for them."
            }
          },
          {
            "@type": "Question",
            "name": "Does a low score mean my page is bad?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Not necessarily - it may mean a signal could not be measured. DatIQ never scores an unmeasured signal as zero; it excludes it and redistributes its weight, then reports the coverage the score was computed from. Scoring a missing measurement as zero would drag your trend line down during a third-party outage and show a phantom improvement when it recovered."
            }
          },
          {
            "@type": "Question",
            "name": "How many audits do I get?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Discoverability audits no longer have a separate allowance — they spend from the same credit pool as everything else, at 19 credits for a standard run (add 2 per extra citation prompt beyond the five included). So Free's 500 credits cover about 26 audits, Go's 1,500 cover about 78, and Pro's 10,000 cover about 526, if you spend them on nothing else. Competitive benchmarks need a plan of Select or above. Everything is priced in one unit: credits. 1 credit = one page fetch; a Discoverability audit is 19. Free includes 500 credits, one-time and never resetting, with no credit card. Paid plans start at $5 / ₹449 a month (Go, 1,500 credits). Select is $15 / ₹1,449 (5,000), Pro $25 / ₹2,449 (10,000), Business $85 / ₹7,849 (50,000) and Agency $200 / ₹19,449 (150,000 on fair use). USD and INR are set prices, not conversions of one another. Annual billing is cheaper again. Credit packs top up any plan and never expire, and a plan's price and limits are fixed for the period you bought."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/recruiting": {
    "title": "Recruiting research with DatIQ - brief yourself on a company before the call",
    "description": "Turn a company's public site into a briefing you can use in a candidate call: what they build, how they position, who leads which function, and a watch on their hiring pages.",
    "canonical": "https://datiq.app/use-cases/recruiting",
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
            "name": "Recruiting",
            "item": "https://datiq.app/use-cases/recruiting"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Recruiting",
        "description": "Turn a company's public site into a briefing you can use in a candidate call: what they build, how they position, who leads which function, and a watch on their hiring pages.",
        "datePublished": "2026-09-04",
        "dateModified": "2026-09-04",
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
            "name": "How can DatIQ help a recruiter research a company?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Run the company domain through the account brief template and DatIQ returns what they do, who they sell to, how they position themselves, the proof points they lead with, and the leadership names and titles their site publishes. It is the briefing you would otherwise assemble from ten browser tabs."
            }
          },
          {
            "@type": "Question",
            "name": "Can DatIQ find candidate or employee email addresses?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "DatIQ surfaces only the contact information a company publishes publicly, such as team pages, leadership pages and press contacts. It does not generate or guess personal email addresses, and a detail it could not find is reported as absent rather than filled in."
            }
          },
          {
            "@type": "Question",
            "name": "Can I be told when a company starts hiring?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Add their careers or leadership page to a watchlist and DatIQ re-reads it on a cadence, classifies what changed, and can route a material change to Slack, email or a webhook."
            }
          },
          {
            "@type": "Question",
            "name": "Can I share the research with a candidate?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Publish any result as a report at its own link and choose who can open it - anyone with the link, your workspace, or named email addresses only. Non-public reports are not indexed by search engines, and a link can be permanently revoked. Sharing is free on every plan. Everything is priced in one unit: credits. 1 credit = one page fetch; a Discoverability audit is 19. Free includes 500 credits, one-time and never resetting, with no credit card. Paid plans start at $5 / ₹449 a month (Go, 1,500 credits). Select is $15 / ₹1,449 (5,000), Pro $25 / ₹2,449 (10,000), Business $85 / ₹7,849 (50,000) and Agency $200 / ₹19,449 (150,000 on fair use). USD and INR are set prices, not conversions of one another. Annual billing is cheaper again. Credit packs top up any plan and never expire, and a plan's price and limits are fixed for the period you bought."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/revops": {
    "title": "Account list cleaning, ICP scoring and routing for RevOps - DatIQ",
    "description": "Import company domains, enrich each from its own site, score against ICP rules you write, and route qualified accounts to HubSpot, Slack, email or a webhook. Every field carries its source.",
    "canonical": "https://datiq.app/use-cases/revops",
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
            "name": "RevOps",
            "item": "https://datiq.app/use-cases/revops"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "RevOps",
        "description": "Import company domains, enrich each from its own site, score against ICP rules you write, and route qualified accounts to HubSpot, Slack, email or a webhook. Every field carries its source.",
        "datePublished": "2026-09-25",
        "dateModified": "2026-09-25",
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
            "name": "How does DatIQ score an account list for RevOps?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Paste company domains or names. DatIQ reads each company's own website for firmographics, then scores every account against ICP rules you write - field, operator, value and weight, plus required criteria and a threshold. Each score carries its coverage."
            }
          },
          {
            "@type": "Question",
            "name": "What happens when DatIQ cannot find a field?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "It leaves the field absent rather than estimating it. An unmeasured ICP criterion is excluded and its weight redistributed across the criteria that were measured, so a score is never pulled down by something DatIQ could not read."
            }
          },
          {
            "@type": "Question",
            "name": "Where do qualified accounts go?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A signal rule sends them to HubSpot, Slack, email or a webhook. A rule can listen to one specific list, and the Workflow hub shows any list that no rule is listening to."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/product-marketing": {
    "title": "Competitor battlecards and claims for product marketing - DatIQ",
    "description": "Read competitor pricing, proof and positioning under one shared schema, watch the pages that matter, and hear about material changes. Every battlecard claim carries the page and quote it came from.",
    "canonical": "https://datiq.app/use-cases/product-marketing",
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
            "name": "Product Marketing",
            "item": "https://datiq.app/use-cases/product-marketing"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Product Marketing",
        "description": "Read competitor pricing, proof and positioning under one shared schema, watch the pages that matter, and hear about material changes. Every battlecard claim carries the page and quote it came from.",
        "datePublished": "2026-09-25",
        "dateModified": "2026-09-25",
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
            "name": "How does DatIQ help build a battlecard?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The Competitor Pricing Tracker, the Customer Proof Extractor and the AI Visibility & Competitive Brief read you and up to four competitors under one shared schema, so pricing, proof and positioning sit in comparable rows, each with its source."
            }
          },
          {
            "@type": "Question",
            "name": "Will a competitor watch flood me with alerts?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. The first check is a silent baseline, and each change is classified by materiality: critical changes alert immediately, high daily, medium weekly, and low never."
            }
          },
          {
            "@type": "Question",
            "name": "What if a competitor's page stops showing a field?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "DatIQ reports it as no longer observed rather than as a deletion, because the usual cause is a page that failed to render - not a competitor removing their pricing."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/brand-cro": {
    "title": "Brand, share of voice and trust for growth and CRO teams - DatIQ",
    "description": "Record your company facts once, approved by a person, and DatIQ checks every audited page against them. Score SEO, AEO and GEO visibility, compare share of voice, and score trust by evidence quality.",
    "canonical": "https://datiq.app/use-cases/brand-cro",
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
            "name": "Brand & CRO",
            "item": "https://datiq.app/use-cases/brand-cro"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Brand & CRO",
        "description": "Record your company facts once, approved by a person, and DatIQ checks every audited page against them. Score SEO, AEO and GEO visibility, compare share of voice, and score trust by evidence quality.",
        "datePublished": "2026-09-25",
        "dateModified": "2026-09-25",
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
            "name": "What is a business truth record?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The facts about your company - legal name, canonical domain and more - recorded once and approved by a person. DatIQ compares each audited page against it and flags a contradiction separately from an absence, because they need opposite fixes."
            }
          },
          {
            "@type": "Question",
            "name": "How does DatIQ score trust?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "By the quality of the evidence, not its volume. Each signal is weighted by how independent and how verifiable it is, so one verifiable third-party record outweighs any number of unattributed testimonials on your own site."
            }
          },
          {
            "@type": "Question",
            "name": "Does an outage lower my score?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. A signal DatIQ could not measure is excluded and its weight redistributed, and every score carries its coverage, so a third-party outage never appears as a drop in your score."
            }
          }
        ]
      }
    ]
  },
  "/use-cases/investor-diligence": {
    "title": "Pre-meeting diligence with DatIQ - a sourced company brief in minutes",
    "description": "A source-backed company brief before a first call: what they build, how they price, the traction signals they publish, the team, and the questions worth asking. Every claim carries a citation.",
    "canonical": "https://datiq.app/use-cases/investor-diligence",
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
            "name": "Investor Diligence",
            "item": "https://datiq.app/use-cases/investor-diligence"
          }
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Investor Diligence",
        "description": "A source-backed company brief before a first call: what they build, how they price, the traction signals they publish, the team, and the questions worth asking. Every claim carries a citation.",
        "datePublished": "2026-09-04",
        "dateModified": "2026-09-04",
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
            "name": "What is in a DatIQ pre-meeting diligence brief?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Positioning and product surface, pricing model and go-to-market, the named customers, case studies and quantified outcomes the company publishes, the leadership its site exposes, and a set of questions framed for an intro call, a diligence deep-dive or a partnership conversation."
            }
          },
          {
            "@type": "Question",
            "name": "Can I trust the facts in the brief?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Every fact carries the page it was read from and the quote that supports it, so you can check anything before you repeat it. Anything DatIQ could not observe is marked absent rather than estimated - which means a brief is sometimes shorter than you hoped, and never contains a plausible number with no source."
            }
          },
          {
            "@type": "Question",
            "name": "Can I run diligence across a whole portfolio or pipeline?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Run a list of domains through the same template and you get a like-for-like comparison table rather than a folder of differently-shaped notes, because every company is read with the same schema."
            }
          },
          {
            "@type": "Question",
            "name": "Can I control who sees a brief?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Each report has its own visibility: private, anyone with the link, workspace only, named email addresses only, or public. Only public reports are indexable; everything else carries a noindex instruction. A link can be revoked permanently, and reports can carry an expiry date. Everything is priced in one unit: credits. 1 credit = one page fetch; a Discoverability audit is 19. Free includes 500 credits, one-time and never resetting, with no credit card. Paid plans start at $5 / ₹449 a month (Go, 1,500 credits). Select is $15 / ₹1,449 (5,000), Pro $25 / ₹2,449 (10,000), Business $85 / ₹7,849 (50,000) and Agency $200 / ₹19,449 (150,000 on fair use). USD and INR are set prices, not conversions of one another. Annual billing is cheaper again. Credit packs top up any plan and never expire, and a plan's price and limits are fixed for the period you bought."
            }
          }
        ]
      }
    ]
  },
};

/**
 * Look up a page's SEO block. Returns undefined for an unknown path, which
 * useSeo() handles by leaving the document head alone.
 */
/**
 * Human labels for path segments, where the slug alone reads badly.
 * Anything absent is title-cased from the slug.
 */
const SEGMENT_LABELS = {
  "use-cases": "Use cases",
  "vs": "Compare",
  "for-sales": "For sales",
  "for-seo": "For SEO",
  "for-ci": "For competitive intelligence",
  "for-finance": "For finance",
  "for-healthcare": "For healthcare",
  "for-retail": "For retail",
  "for-legal": "For legal",
  "seo-audit": "SEO audit",
  "faq": "FAQ",
};

const titleCase = (slug) =>
  slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * BreadcrumbList JSON-LD for a path.
 *
 * Added because a discoverability audit raised SH-09 — no BreadcrumbList places
 * the page within the site, so a machine has to infer topical context. Built
 * from the URL rather than hand-written per page, so it cannot drift out of
 * sync with the routes, and it mirrors the navigation path a reader actually
 * walks rather than an idealised site map.
 *
 * Returns null for the homepage: a breadcrumb whose only item is the page
 * itself describes nothing.
 */
export function breadcrumbFor(path) {
  if (!path || path === "/") return null;
  const segments = path.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const items = [{ "@type": "ListItem", position: 1, name: "Home", item: "https://datiq.app/" }];
  let acc = "";
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    items.push({
      "@type": "ListItem",
      position: i + 2,
      name: SEGMENT_LABELS[seg] || titleCase(seg),
      item: `https://datiq.app${acc}`,
    });
  });
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}

export function seoFor(path) {
  return PAGE_SEO[path];
}
