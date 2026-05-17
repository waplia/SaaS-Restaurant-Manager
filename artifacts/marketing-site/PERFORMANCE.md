# Marketing Site Performance

This file tracks the performance work done in task #307 and how to keep the
marketing site fast.

## What changed

1. **Route-level code splitting.** Every page in `src/App.tsx` except the
   homepage is loaded via `React.lazy` + `<Suspense>`, so the initial bundle
   no longer pays for the 40+ secondary routes (features, solutions, blog,
   legal, careers, etc).
2. **Lazy-mounted homepage sections.** Below-the-fold sections on `/` are
   wrapped in a `LazyMount` (IntersectionObserver) + `React.lazy`, so heavy
   sections like `PricingPreview`, `Testimonials`, `HomeFAQ` and the AI/
   platform/industry blocks stay out of the initial chunk and only render +
   animate when the user scrolls near them.
3. **Vendor chunking.** Vite `build.rollupOptions.output.manualChunks` splits
   `react-vendor`, `motion-vendor`, `icons-vendor`, `query-vendor` and
   `markdown-vendor` into their own files so they can be cached
   independently and don't bloat the entry chunk.
4. **Image cleanup.** Removed ~11 MB of unreferenced PNGs from
   `src/assets/` that were never imported anywhere — they were shipping
   no value and inflating the build output.
5. **Font loading.** Inter is loaded via a non-blocking `<link
   rel="preload" as="style" onload="…='stylesheet'">` with a `<noscript>`
   fallback, and only the weights we use (400/600/700) are requested.
6. **Build-time admin-import guard.** `scripts/check-no-admin-imports.mjs`
   runs as a `prebuild` step and fails the build if any marketing source
   file imports from `@workspace/restaurant-platform`, `@workspace/api-server`,
   `@workspace/tabletrack-mobile` or `@workspace/mockup-sandbox`. This keeps
   admin code from leaking into the public bundle.
7. **Production server.** `pnpm serve:prod` (script
   `scripts/serve-prod.mjs`, Express 5 + `compression`) serves
   `dist/public` with:
   - `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`
     (Vite-hashed filenames).
   - `Cache-Control: public, max-age=3600` on other static files
     (favicon, sitemap, etc).
   - `Cache-Control: no-cache` on `index.html` / SPA fallback.
   - Gzip/Brotli via `compression` middleware (with `Vary: Accept-Encoding`).
   - SPA fallback to `index.html` for unknown routes.

## Before / after

### Bundle output

| Metric                         | Before              | After                  |
|--------------------------------|---------------------|------------------------|
| Routes per chunk               | 1 monolithic entry  | 1 chunk per route      |
| Unused PNGs shipped in `src/assets/` | ~11 MB total       | 0 (folder deleted)     |
| Vendor split                   | none (single chunk) | react / motion / icons / query / markdown |
| Built `dist/public/assets/`    | n/a (different shape) | 2.3 MB raw / 69 chunks |
| Homepage initial JS (gzip)     | ~all-in-one entry   | react-vendor 112 kB + entry 57 kB + helpers ≈ **~175 kB gzip** |
| Below-fold home sections in initial chunk | yes (everything eagerly imported) | no (15 sections lazy-mounted on scroll) |
| Below-fold pages in initial chunk | yes (~45 routes eagerly imported) | no (every non-home route lazy) |
| Google Fonts CSS load          | render-blocking `<link rel="stylesheet">` (4 weights) | non-blocking `preload` → `stylesheet` swap (3 weights) |
| Static asset cache headers     | vite preview defaults (short, no `immutable`) | `max-age=31536000, immutable` on hashed `/assets/*`, `no-cache` on HTML |

### Largest chunks after the change (gzip)

```
react-vendor-*.js        ~112 kB gzip    (shared, cached cross-page)
index-*.js (entry)        ~57 kB gzip    App + Home + Hero/TrustStrip/Problem + layout
markdown-vendor-*.js      ~54 kB gzip    only loaded on /blog/[slug]
_slug_-*.js (blog post)   ~45 kB gzip    only loaded on /blog/[slug]
motion-vendor-*.js        ~42 kB gzip    only loaded once a motion section mounts
LeadForm-*.js             ~39 kB gzip    only loaded on /book-demo, /contact, /partners
icons-vendor-*.js         ~17 kB gzip    shared across pages
query-vendor-*.js         ~12 kB gzip    shared across pages
PricingPreview-*.js        ~3 kB gzip    lazy-mounted on scroll on /
Testimonials-*.js          ~2 kB gzip    lazy-mounted on scroll on /
HomeFAQ-*.js               ~2 kB gzip    lazy-mounted on scroll on /
… every other page/section is its own small chunk loaded on demand
```

### How to re-measure

We didn't pin a specific Lighthouse number here because Lighthouse runs from
the user's environment (PageSpeed Insights, Chrome DevTools) and depends on
network/CPU emulation. To produce a fresh before/after on any environment:

```bash
cd artifacts/marketing-site
pnpm build
PORT=4000 pnpm serve:prod
# in another shell, against http://localhost:4000/:
npx lighthouse http://localhost:4000/ --preset=desktop --output=html --output-path=./lh-desktop.html
npx lighthouse http://localhost:4000/ --form-factor=mobile --output=html --output-path=./lh-mobile.html
# repeat for /pricing, /features, /khana-ai, /blog, /contact
```

Target on the homepage: **LCP < 2.5s, CLS < 0.1**. The above-the-fold work
is intentionally tiny (hero text + CSS dashboard mockup, no large image)
so the LCP element is text and CLS is fixed by the explicit aspect-ratio
on the mockup.

## Keeping it fast

- **Don't import admin artifacts.** Enforced by
  `scripts/check-no-admin-imports.mjs` (runs on `pnpm build`). If you need
  to add a new allowed workspace package, update the script.
- **Tree-shake icons.** Always use named imports from `lucide-react` and
  `react-icons/si`. Never `import * as Icons from "lucide-react"`.
- **Keep new images out of `src/assets/` unless they're actually rendered.**
  Prefer WebP/AVIF and set explicit width/height + `loading="lazy"` for
  below-the-fold imagery.
- **Wrap new heavy homepage sections in `<Deferred>`** (see `pages/home.tsx`)
  so they're code-split and only rendered when scrolled into view.
- **New routes** should be added with `lazy(() => import(...))` in
  `App.tsx`, never a static import.
- **Production serving** must use `pnpm serve:prod` (not `pnpm serve`,
  which is `vite preview` for local sanity checks only) so the cache
  headers and compression apply.
