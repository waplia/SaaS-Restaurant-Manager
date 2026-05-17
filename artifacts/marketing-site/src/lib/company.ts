/**
 * Single source of truth for company / product / contact info used across the
 * public marketing site. Pages, footer, legal docs and JSON-LD all read from
 * here so we never drift again.
 */

export const COMPANY = {
  // Product (this is the brand Google should see in titles, descriptions, and schema)
  product: "KhanaLagao",
  productAlternateName: "KhanaLagao Restaurant OS",
  productTagline: "Restaurant OS for Modern Food Businesses",
  productPositioning:
    "Restaurant Operating System + Growth Cloud + Finance + Khana AI",
  productShortDescription:
    "KhanaLagao is a complete restaurant operating system for POS billing, QR menu, kitchen/KDS, inventory, payroll, finance, growth, reports and Khana AI.",
  productOgDescription:
    "Run your restaurant smarter with KhanaLagao — POS, QR menu, inventory, payroll, finance, growth tools and Khana AI in one platform.",
  productTwitterDescription:
    "Complete Restaurant OS with POS, QR Menu, Inventory, Payroll, Finance, Growth Engine and Khana AI.",
  proudlyBuiltLine:
    "KhanaLagao is proudly built by Waplia Digital Solutions from Jaipur, India.",

  // Legal entity — used ONLY in the footer copyright row, legal pages, About story,
  // and the "proudly built" attribution. Never in <title>, meta description, OG/Twitter,
  // or the user-visible name in structured data.
  legalName: "Waplia Digital Solutions",
  legalShortName: "Waplia",

  // Contact
  phoneDisplay: "+91 8306020200",
  phoneE164: "+918306020200",
  phoneHref: "tel:+918306020200",
  whatsappNumber: "918306020200",
  whatsappUrl: "https://wa.me/918306020200",
  supportEmail: "support@khanalagao.com",
  salesEmail: "sales@khanalagao.com",

  // Location
  addressLine: "Malviya Nagar",
  city: "Jaipur",
  region: "Rajasthan",
  country: "India",
  countryCode: "IN",
  fullAddress: "Malviya Nagar, Jaipur, Rajasthan, India",

  // Site
  siteUrl: "https://khanalagao.com",
  copyrightYear: new Date().getFullYear(),
  copyrightLine: `© ${new Date().getFullYear()} KhanaLagao by Waplia Digital Solutions. All rights reserved.`,
} as const;

export type CompanyInfo = typeof COMPANY;

/** Six legal pages, kept in one place for the footer bottom-bar row. */
export const LEGAL_LINKS: { title: string; href: string }[] = [
  { title: "Privacy Policy", href: "/privacy-policy" },
  { title: "Terms & Conditions", href: "/terms" },
  { title: "Refund Policy", href: "/refund-policy" },
  { title: "Cookie Policy", href: "/cookie-policy" },
  { title: "Data Processing Agreement", href: "/data-processing-agreement" },
  { title: "Acceptable Use Policy", href: "/acceptable-use-policy" },
];

/**
 * Organization JSON-LD ready to drop into a <script type="application/ld+json"> tag.
 *
 * Per SEO direction: the user-visible Organization `name` is the brand "KhanaLagao".
 * The legal entity (Waplia) is intentionally NOT included here — structured data
 * is SEO-facing and surfaces in Google's Knowledge Graph, so the brand identity
 * stays consistent. Waplia remains only in the footer copyright row, legal
 * pages, and the About story.
 */
export const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: COMPANY.product,
  alternateName: COMPANY.productAlternateName,
  url: COMPANY.siteUrl,
  logo: `${COMPANY.siteUrl}/logo.png`,
  description: COMPANY.productTagline,
  telephone: COMPANY.phoneDisplay,
  email: COMPANY.supportEmail,
  address: {
    "@type": "PostalAddress",
    streetAddress: COMPANY.addressLine,
    addressLocality: COMPANY.city,
    addressRegion: COMPANY.region,
    addressCountry: COMPANY.countryCode,
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      telephone: COMPANY.phoneDisplay,
      contactType: "customer support",
      availableLanguage: ["English", "Hindi"],
      areaServed: "IN",
    },
  ],
};
