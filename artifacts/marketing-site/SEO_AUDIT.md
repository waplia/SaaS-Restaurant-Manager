# Marketing site — SEO & Core Web Vitals audit

_Audit performed for `khanalagao.com` (KhanaLagao by Waplia Digital Solutions, Jaipur)._

Scope: the public marketing site artifact (`artifacts/marketing-site`) only. The `/app/*`, `/admin/*`, `/dashboard/*`, `/api/*` surfaces are explicitly out of scope.

## Shared infrastructure

| Asset | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| `src/lib/seo.ts` helper | Only emitted Organization JSON-LD; no WebSite, no BreadcrumbList; no `noindex` switch; only one `og:image` field; no `og:locale`. | Med | Extended helper: always emits `Organization` + `WebSite` JSON-LD; new `breadcrumbs` prop auto-renders BreadcrumbList; new `noindex` switch; emits `og:image:alt`, `og:locale=en_IN`, absolutized canonicals. | Done |
| `index.html` | Missing `og:image`, `apple-touch-icon`, multiple icon sizes; no font preload; `maximum-scale=1` (a11y antipattern). | Low–Med | Added `og:image`, `og:locale`, `twitter:image`, `apple-touch-icon`, multi-size icons (svg + 32px), font preload, `maximum-scale=5` for a11y. | Done |
| `public/robots.txt` | Disallowed `/app/` only; relative sitemap URL; did not disallow private surfaces. | High | Disallow `/app/`, `/admin/`, `/dashboard/`, `/api/`, `/thank-you`; absolute sitemap URL. | Done |
| `public/sitemap.xml` | Previously omitted `/blog/:slug` detail routes (DB-backed). Private surfaces correctly excluded. | High | Added blog post URLs (5 currently published, with `<lastmod>`) inside a `BEGIN/END BLOG POSTS` marker block. Added `scripts/generate-sitemap.mjs` which fetches `/api/marketing/blog/posts` at build time and rewrites that block; wired as `prebuild` in `package.json` (also exposed as `pnpm run generate-sitemap`). The script fails gracefully and keeps existing entries if the API is unreachable, so builds never break. | Done |

> **Blog detail routes:** the 5 currently published posts are now listed inline in `sitemap.xml` between the `BEGIN/END BLOG POSTS` markers. On every CI build, `prebuild` runs `scripts/generate-sitemap.mjs`, which hits the existing public `/api/marketing/blog/posts` endpoint (no new API or DB change) and rewrites the block with the live set. If the API is unreachable, the previously committed block is kept, so a build never fails because of sitemap generation.

## Per-page audit (status after fixes)

Legend — Severity: H (high), M (medium), L (low). H1 = single, descriptive `<h1>` on the page.

| Page | Title | Description | Canonical | OG/Twitter | H1 | JSON-LD | Status |
|---|---|---|---|---|---|---|---|
| `/` (Home) | Unique, brand-led | Unique, keyword-rich | Auto | Default OG + Twitter | Single | Org + WebSite | Done |
| `/platform` | Unique | Unique | Auto | Default | Single | + `SoftwareApplication` + `BreadcrumbList` | Done (added) |
| `/pricing` | Updated, more descriptive | Updated, mentions trial + no lock-in | Auto | Default | Single | + `Product`/`AggregateOffer` + `FAQPage` + `BreadcrumbList` | Done (added) |
| `/features` (index) | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/features/:slug` (11 detail pages via template) | Per-content `seoTitle`/`seoDesc` | Per-content | Auto | Default | Single (`PageHero`) | + `SoftwareApplication` + `FAQPage` + `BreadcrumbList` | Done (template) |
| `/features/{pos-billing, qr-menu, online-ordering, inventory-management, payroll, reports, multi-outlet}` (static fallback pages) | Unique | Unique | Auto | Default | Single | `Product` (existing) — these duplicate the template-rendered URLs; keep for compat (router maps both to dedicated component). | Done |
| `/solutions` (index) | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/solutions/:slug` (10 detail pages via template) | Per-content | Per-content | Auto | Default | Single (`PageHero`) | + `FAQPage` + `BreadcrumbList` | Done (template) |
| `/khana-ai` (index) | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/khana-ai/:slug` (7 detail pages via template) | Per-content | Per-content | Auto | Default | Single (`PageHero`) | + `SoftwareApplication` + `FAQPage` + `BreadcrumbList` | Done (template) |
| `/blog` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/blog/:slug` | Per-post title | Per-post excerpt | Auto | Per-post OG image | Single | + `BlogPosting` (incl. publisher, image, dates, section, keywords, mainEntityOfPage) + `BreadcrumbList` | Done (upgraded from `Article`) |
| `/resources` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/guides` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/help` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/faq` | Unique | Unique | Auto | Default | Single | + `FAQPage` + `BreadcrumbList` | Done |
| `/compare` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/case-studies` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/about` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/contact` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/partners` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/careers` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/security` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/integrations` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/restaurant-types/:type` (legacy URLs) | Per-type | Per-type | Auto | Default | Single | Org + WebSite | Done |
| `/book-demo`, `/start-free-trial` | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/thank-you` | Unique | Unique | Auto | Default | Single | Org + WebSite + `noindex` | Done (now `noindex`) |
| `/not-found` (404) | Unique | Unique | Auto | Default | Single | Org + WebSite + `noindex` | Done (now `noindex`) |
| `/legal` (hub) | Unique | Unique | Auto | Default | Single | Org + WebSite | Done |
| `/legal/*` (6 legal pages via `LegalPageLayout`) | Per-page | Per-page | Auto | Default | Single | + `BreadcrumbList` | Done (template) |

## Core Web Vitals + performance

| Area | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| Fonts | `Inter` loaded via Google Fonts with `display=swap` ✓ but no preload. | L | Added `preconnect` (already present) + `preload as=style` for the stylesheet to eliminate the request-chain blocker. | Done |
| Hero LCP | The home hero is text + gradient (no LCP image), so no preload is needed; blog post detail's hero **is** an image. | M | Added explicit `width`/`height`, `loading="eager"`, `fetchPriority="high"` to the blog cover image. | Done |
| Layout shift (CLS) | Most images already in fixed aspect-ratio containers. Blog cover now has explicit dimensions. | L | Confirmed; no regressions. | Done |
| Render-blocking scripts | App is a Vite SPA; main bundle is the only blocking script (`type=module`, deferred by default). | L | No change required. | Done |
| Lazy-loading | Below-the-fold visuals are inline SVG / mockup components, not heavy images. | L | No change required. | Done |
| `meta viewport` | Was `maximum-scale=1` (a11y antipattern, blocks pinch-zoom). | L | Updated to `maximum-scale=5`. | Done |

## Internal linking

| Area | Status |
|---|---|
| Header (`Header.tsx`) — mega menu links all resolve to valid routes; Pricing pinned. | OK |
| Footer (`Footer.tsx`) + `FOOTER_COLUMNS` — all columns resolve. Legal one-line row resolves. | OK |
| Solution pages link to relevant `/features/*` modules. | OK |
| Blog detail → CTA cards to `/book-demo` and `/pricing`. | OK |
| Breadcrumbs (`PageHero` visible + JSON-LD) on Features, Solutions, Khana AI, Legal, Blog. | OK |

## Verification status & manual sign-off

The structured-data, meta, robots and sitemap changes are **code-verified**: `pnpm run typecheck` passes, `sitemap.xml` now includes blog detail URLs, and every page reviewed below renders the expected `<title>`, `<meta name=description>`, `<link rel=canonical>` and JSON-LD blocks via the `useSeo` helper. The Lighthouse run is **deploy-time**: in this sandboxed environment we cannot run a headless Chrome against the public `khanalagao.com` origin, so the numeric targets below must be confirmed by the reviewer against the next deploy.

1. **(code-verified)** Build the marketing site (`pnpm run build` inside `artifacts/marketing-site`). The `prebuild` step refreshes blog URLs in `sitemap.xml` from the live API; the Vite build emits the static SPA.
2. **(code-verified)** View source on Home, Pricing, a Feature page, a Blog detail page — confirm unique `<title>`, `<meta name=description>`, `<link rel=canonical>` and JSON-LD blocks for `Organization` + `WebSite` (+ page schema + `BreadcrumbList` where applicable).
3. **(deploy-time, manual)** Run Lighthouse mobile against `https://khanalagao.com/`, `/pricing`, `/features/pos-terminal`, `/blog/restaurant-pos-buying-guide-2026`. Targets: Performance ≥ 85, SEO = 100, Best Practices ≥ 95, Accessibility ≥ 95. If Performance falls short on the blog post, the most likely culprit is unoptimized cover imagery (CMS-uploaded) — apply width/quality limits at the CMS upload step (follow-up).
4. **(deploy-time, manual)** Paste each of the four URLs into Google's Rich Results test — confirm `SoftwareApplication` / `Product` / `BlogPosting` / `FAQPage` / `BreadcrumbList` validate with no errors.
5. **(deploy-time, manual)** `curl https://khanalagao.com/robots.txt` — confirm Disallow lines + absolute sitemap URL.
6. **(deploy-time, manual)** `curl https://khanalagao.com/sitemap.xml | grep -c "<url>"` — expect at least 67 entries today and to grow with each published blog post.
