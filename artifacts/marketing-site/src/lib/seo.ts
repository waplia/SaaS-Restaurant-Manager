import { useEffect } from "react";
import { COMPANY, ORG_JSON_LD } from "@/lib/company";

export interface BreadcrumbCrumb {
  label: string;
  /** Absolute or root-relative path. Leave undefined for the current page (last crumb). */
  href?: string;
}

interface SeoProps {
  title: string;
  description: string;
  ogImage?: string;
  ogType?: "website" | "article" | "product";
  /** Absolute or path URL for canonical + og:url. If omitted, derived from window.location.pathname. */
  url?: string;
  /** Optional page-specific JSON-LD schema. Organization + WebSite always emit alongside. */
  schema?: Record<string, any> | Record<string, any>[];
  /** Optional breadcrumb trail. Renders a BreadcrumbList JSON-LD alongside the page schema. */
  breadcrumbs?: BreadcrumbCrumb[];
  /** Set to true on pages that should not be indexed (e.g. thank-you, 404). */
  noindex?: boolean;
}

const SCRIPT_ID_PAGE = "ld-json-page";
const SCRIPT_ID_ORG = "ld-json-org";
const SCRIPT_ID_SITE = "ld-json-site";
const SCRIPT_ID_BREADCRUMB = "ld-json-breadcrumb";

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: COMPANY.product,
  alternateName: COMPANY.productAlternateName,
  url: COMPANY.siteUrl,
  description: COMPANY.productTagline,
  publisher: { "@type": "Organization", name: COMPANY.product },
  potentialAction: {
    "@type": "SearchAction",
    target: `${COMPANY.siteUrl}/blog?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

function absolutize(path: string): string {
  if (!path) return COMPANY.siteUrl;
  if (path.startsWith("http")) return path;
  return `${COMPANY.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function upsertScript(id: string, payload: unknown) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(payload);
}

function removeScript(id: string) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function upsertLinkRel(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function useSeo({
  title,
  description,
  ogImage = `${COMPANY.siteUrl}/opengraph.jpg`,
  ogType = "website",
  url,
  schema,
  breadcrumbs,
  noindex = false,
}: SeoProps) {
  useEffect(() => {
    // Single source of truth for the title used by <title>, og:title, and
    // twitter:title — guarantees every public page ends in "| KhanaLagao"
    // without each caller having to remember the suffix.
    const effectiveTitle = title.includes(COMPANY.product)
      ? title
      : `${title} | ${COMPANY.product}`;
    document.title = effectiveTitle;

    // Canonical URL — required for SEO. Absolute, derived from siteUrl + path.
    const path = url ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const canonicalUrl = absolutize(path);
    upsertLinkRel("canonical", canonicalUrl);

    // Standard meta
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");

    // Open Graph
    upsertMeta("property", "og:title", effectiveTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:image", ogImage);
    upsertMeta("property", "og:image:alt", `${COMPANY.product} — ${effectiveTitle}`);
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:site_name", COMPANY.product);
    upsertMeta("property", "og:locale", "en_IN");

    // Twitter
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", effectiveTitle);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", ogImage);

    // JSON-LD — Organization + WebSite always emitted; page-specific schema(s) layered on top.
    upsertScript(SCRIPT_ID_ORG, ORG_JSON_LD);
    upsertScript(SCRIPT_ID_SITE, WEBSITE_JSON_LD);

    if (schema) {
      upsertScript(SCRIPT_ID_PAGE, schema);
    } else {
      removeScript(SCRIPT_ID_PAGE);
    }

    if (breadcrumbs && breadcrumbs.length > 0) {
      const items = breadcrumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.label,
        ...(c.href ? { item: absolutize(c.href) } : {}),
      }));
      upsertScript(SCRIPT_ID_BREADCRUMB, {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items,
      });
    } else {
      removeScript(SCRIPT_ID_BREADCRUMB);
    }
  }, [title, description, ogImage, ogType, url, schema, breadcrumbs, noindex]);
}
