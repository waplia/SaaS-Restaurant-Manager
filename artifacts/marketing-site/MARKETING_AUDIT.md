# KhanaLagao Marketing Site — Route & Content Audit

Maintained for task #268 ("Premium polish of public KhanaLagao marketing site"). This is the canonical audit of every public route, its content owner, and final QA status. Update this file whenever a route is added, renamed, or restructured.

- **Product**: KhanaLagao
- **Company**: Waplia Digital Solutions, Malviya Nagar, Jaipur, Rajasthan, India
- **Phone**: +91 8306020200 · **WhatsApp**: https://wa.me/918306020200 · **Email**: support@khanalagao.com
- **Brand SSOT**: `src/lib/company.ts` (`COMPANY`, `LEGAL_LINKS`, `ORG_JSON_LD`)
- **SEO contract**: `src/lib/seo.ts` (`useSeo` injects title, description, canonical, OG/Twitter, Organization JSON-LD always + optional page schema)
- **Backend**: untouched. Lead capture continues to POST `/api/leads` (existing endpoint).

## Public routes — final QA

| Route | File | useSeo | Brand QA | Forms/CTAs | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | `pages/Home.tsx` | yes | KhanaLagao + Waplia in Footer | Hero CTA → demo / pricing | shipped |
| `/platform` | `pages/platform.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/solutions` | `pages/solutions-index.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/khana-ai` | `pages/khana-ai-index.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/resources` | `pages/resources.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/guides` | `pages/guides.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/case-studies` | `pages/case-studies.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/compare` | `pages/compare.tsx` | yes | KhanaLagao | CTA to demo | shipped |
| `/help` | `pages/help.tsx` | yes | KhanaLagao | CTA → contact | shipped |
| `/faq` | `pages/faq.tsx` | yes (FAQPage schema) | KhanaLagao | CTA → contact | shipped |
| `/partners` | `pages/partners.tsx` | yes | Waplia attribution line | Partner LeadForm → /thank-you | shipped |
| `/careers` | `pages/careers.tsx` | yes | Waplia | mailto careers | shipped |
| `/about` | `pages/about.tsx` | yes | Waplia attribution line | CTA → demo / contact | shipped |
| `/contact` | `pages/contact.tsx` | yes | Waplia attribution line + Jaipur address | LeadForm → /thank-you | shipped |
| `/security` | `pages/security.tsx` | yes | Waplia attribution line | DPA + disclosure mailto | shipped |
| `/thank-you` | `pages/thank-you.tsx` | yes | KhanaLagao | Return-home CTA | shipped |
| `/book-demo` | `pages/book-demo.tsx` | yes | KhanaLagao | LeadForm → /thank-you | shipped |
| `/pricing` | `pages/pricing.tsx` | yes | KhanaLagao | CTA → demo | shipped |
| `/features/*` (dynamic) | `pages/feature-detail.tsx` | yes | KhanaLagao | CTA → demo | shipped |
| `/legal/privacy-policy` → `/privacy-policy` | `pages/legal/privacy-policy.tsx` | yes | Waplia legal block via `LegalPageLayout` | n/a | shipped |
| `/terms` | `pages/legal/terms.tsx` | yes | Waplia legal block | n/a | shipped |
| `/refund-policy` | `pages/legal/refund-policy.tsx` | yes | Waplia legal block | n/a | shipped |
| `/cookie-policy` | `pages/legal/cookie-policy.tsx` | yes | Waplia legal block | n/a | shipped |
| `/data-processing-agreement` | `pages/legal/data-processing-agreement.tsx` | yes | Waplia legal block | n/a | shipped |
| `/acceptable-use-policy` | `pages/legal/acceptable-use-policy.tsx` | yes | Waplia legal block | n/a | shipped |
| `*` (404) | `pages/not-found.tsx` | yes | KhanaLagao | Return-home CTA | shipped |

## SEO contract checklist

- [x] `useSeo` sets `<title>` (with KhanaLagao suffix), `<meta name="description">`, canonical `<link>`, OG title/description/image/type/url/site_name, Twitter card/title/description/image.
- [x] Organization JSON-LD (`ORG_JSON_LD` from `company.ts`) is injected on every page.
- [x] Per-page schema is injected separately with a dedicated `<script id="ld-json-page">` so it cleans up on route change.
- [x] FAQ page emits `FAQPage` schema built from all rendered Q&A blocks.
- [x] Sitemap `public/sitemap.xml` covers every route above.

## Brand contract checklist

- [x] Every page reads contact/company values from `COMPANY` (no hardcoded phone/email/address).
- [x] `appSettings.tsx` defaults derive from `COMPANY`.
- [x] Footer renders one-line legal row from `LEGAL_LINKS` + Waplia copyright row.
- [x] The mandated attribution line ("KhanaLagao is proudly built by Waplia Digital Solutions from Jaipur, India.") is rendered on Footer, About, Contact, Security, Partners, and (via `LegalPageLayout`) every legal page.

## Forms contract checklist

- [x] `LeadForm` POSTs to existing `/api/leads` and redirects to `/thank-you` on success (configurable via `redirectTo`).
- [x] Footer newsletter POSTs to `/api/leads` and redirects to `/thank-you` on success.
- [x] All forms retain loading + error states (toast + button state).

## Out of scope (do not touch in this task)

- Backend routes, DB schema, admin/customer dashboards, API server, tabletrack-mobile, restaurant-platform — none modified.
