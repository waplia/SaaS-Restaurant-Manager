import { useEffect } from "react";

interface SeoProps {
  title: string;
  description: string;
  ogImage?: string;
  ogType?: "website" | "article" | "product";
  url?: string;
  schema?: Record<string, any>;
}

export function useSeo({
  title,
  description,
  ogImage = "https://tabletrack.com/og-image.jpg",
  ogType = "website",
  url,
  schema,
}: SeoProps) {
  useEffect(() => {
    // Update title
    document.title = title.includes("TableTrack") ? title : `${title} | TableTrack`;

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.setAttribute("name", "description");
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute("content", description);

    // Update Open Graph tags
    const updateOgTag = (property: string, content: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("property", property);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    updateOgTag("og:title", title);
    updateOgTag("og:description", description);
    updateOgTag("og:image", ogImage);
    updateOgTag("og:type", ogType);
    if (url) {
      updateOgTag("og:url", url);
    }

    // Twitter tags
    const updateTwitterTag = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    updateTwitterTag("twitter:card", "summary_large_image");
    updateTwitterTag("twitter:title", title);
    updateTwitterTag("twitter:description", description);
    updateTwitterTag("twitter:image", ogImage);

    // JSON-LD Schema
    if (schema) {
      let scriptTag = document.querySelector('script[type="application/ld+json"]');
      if (!scriptTag) {
        scriptTag = document.createElement("script");
        scriptTag.setAttribute("type", "application/ld+json");
        document.head.appendChild(scriptTag);
      }
      scriptTag.textContent = JSON.stringify(schema);
    }

    return () => {
      if (schema) {
        const scriptTag = document.querySelector('script[type="application/ld+json"]');
        if (scriptTag) {
          scriptTag.remove();
        }
      }
    };
  }, [title, description, ogImage, ogType, url, schema]);
}
