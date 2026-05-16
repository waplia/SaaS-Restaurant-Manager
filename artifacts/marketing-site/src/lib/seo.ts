import { useEffect } from "react";
import { COMPANY, ORG_JSON_LD } from "@/lib/company";

interface SeoProps {
  title: string;
  description: string;
  ogImage?: string;
  ogType?: "website" | "article" | "product";
  /** Absolute or path URL for canonical + og:url. If omitted, derived from window.location.pathname. */
  url?: string;
  /** Optional page-specific JSON-LD schema. Organization schema is always emitted alongside. */
  schema?: Record<string, any> | Record<string, any>[];
}

const SCRIPT_ID_PAGE = "ld-json-page";
const SCRIPT_ID_ORG = "ld-json-org";

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
}: SeoProps) {
  useEffect(() => {
    // Title (avoid double-suffix)
    document.title = title.includes(COMPANY.product) ? title : `${title} | ${COMPANY.product}`;

    // Canonical URL — required for SEO. Absolute, derived from siteUrl + path.
    const path = url ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const canonicalUrl = path.startsWith("http")
      ? path
      : `${COMPANY.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
    upsertLinkRel("canonical", canonicalUrl);

    // Standard meta
    upsertMeta("name", "description", description);

    // Open Graph
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:image", ogImage);
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:site_name", COMPANY.product);

    // Twitter
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", ogImage);

    // JSON-LD — Organization always emitted; page-specific schema(s) layered on top.
    upsertScript(SCRIPT_ID_ORG, ORG_JSON_LD);
    if (schema) {
      upsertScript(SCRIPT_ID_PAGE, schema);
    } else {
      // Clear stale page schema from previous route
      const el = document.getElementById(SCRIPT_ID_PAGE);
      if (el) el.remove();
    }
  }, [title, description, ogImage, ogType, url, schema]);
}
