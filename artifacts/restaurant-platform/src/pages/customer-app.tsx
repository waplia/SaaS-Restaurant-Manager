/**
 * Public customer-app shell. Rendered at `/app/:slug`. Pulls the published
 * branding + menu + loyalty + app-exclusive coupons from the public
 * `/public/customer-app/:slug` endpoint and renders a mobile-first,
 * SEO-ready landing experience with deep-links into the existing ordering
 * (`/menu/:slug/:tableId`) and reservation flows.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import {
  MapPin, Phone, Mail, Star, ShoppingBag, Sparkles, ArrowRight, Tag,
  Smartphone, AlertCircle, Award,
} from "lucide-react";

interface PublicCustomerApp {
  restaurant: {
    id: number; name: string; slug: string;
    logoUrl: string | null; currency: string;
    address: string | null; phone: string | null; email: string | null;
  };
  branding: {
    appName: string; tagline: string;
    logoUrl: string | null;
    primaryColor: string; accentColor: string;
    heroImageUrl: string | null;
    heroHeadline: string; heroSubcopy: string;
    aboutTitle: string; aboutBody: string;
    contactPhone: string | null; contactEmail: string | null; contactAddress: string | null;
    gallery: string[];
    reviewWidget: { enabled: boolean; googleReviewLink: string | null };
    seo: { title: string; description: string; ogImageUrl: string | null };
    customDomain: string | null;
  };
  menu: { categories: Array<{ id: number; name: string; items: Array<{
    id: number; name: string; description: string | null; price: string;
    imageUrl: string | null; isVeg: boolean; isVegan: boolean; tags: string[];
  }> }> };
  coupons: Array<{ code: string; description: string | null; discountType: string; discountValue: string }>;
  loyalty: { enabled: boolean; pointsPerCurrencyUnit?: number; redemptionRate?: number; tiers?: Array<{ id: string; name: string; threshold: number }> };
  publishedAt: string | null;
}

const API_BASE = "/api";

function currSymbol(c: string): string {
  return c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "₹";
}

function resolveImg(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/objects/")) return `${API_BASE}/public/storage${url}`;
  return url;
}

export default function CustomerAppPage() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<{ loading: boolean; error: string | null; data: PublicCustomerApp | null }>({
    loading: true, error: null, data: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/public/customer-app/${slug}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setState({ loading: false, error: body?.code === "app_not_published" ? "not_published" : "not_found", data: null });
          return;
        }
        const data: PublicCustomerApp = await res.json();
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch {
        if (!cancelled) setState({ loading: false, error: "network", data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // SEO — set <title>, meta description, OG tags, theme-color, JSON-LD.
  useEffect(() => {
    if (!state.data) return;
    const { branding, restaurant } = state.data;
    document.title = branding.seo.title;
    setMeta("description", branding.seo.description);
    setMeta("theme-color", branding.primaryColor);
    setOg("og:title", branding.seo.title);
    setOg("og:description", branding.seo.description);
    setOg("og:type", "website");
    if (branding.seo.ogImageUrl) setOg("og:image", resolveImg(branding.seo.ogImageUrl));
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: branding.appName,
      address: branding.contactAddress ?? restaurant.address ?? undefined,
      telephone: branding.contactPhone ?? restaurant.phone ?? undefined,
      email: branding.contactEmail ?? restaurant.email ?? undefined,
      image: branding.heroImageUrl ? resolveImg(branding.heroImageUrl) : undefined,
    };
    setJsonLd(jsonLd);
  }, [state.data]);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>
    );
  }

  if (state.error === "not_published") {
    return <NoticePage icon={Smartphone} title="App not published yet" body="This customer app hasn't been published. Please check back soon." />;
  }
  if (state.error === "not_found") {
    return <NoticePage icon={AlertCircle} title="App not found" body="We couldn't find a customer app at this address." />;
  }
  if (!state.data) {
    return <NoticePage icon={AlertCircle} title="Something went wrong" body="Please try again in a moment." />;
  }

  return <CustomerApp data={state.data} />;
}

function CustomerApp({ data }: { data: PublicCustomerApp }) {
  const { branding, restaurant, menu, coupons, loyalty } = data;
  const symbol = currSymbol(restaurant.currency);
  const orderingHref = `/menu/${restaurant.slug}`;
  const reserveHref = `/book/${restaurant.slug}`;

  const heroStyle = useMemo<React.CSSProperties>(() => ({
    backgroundImage: branding.heroImageUrl
      ? `linear-gradient(135deg, ${branding.primaryColor}cc 0%, ${branding.accentColor}aa 100%), url(${resolveImg(branding.heroImageUrl)})`
      : `linear-gradient(135deg, ${branding.primaryColor} 0%, ${branding.accentColor} 100%)`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  }), [branding.heroImageUrl, branding.primaryColor, branding.accentColor]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* App-style top bar */}
      <header className="sticky top-0 z-30 backdrop-blur bg-background/80 border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          {branding.logoUrl && (
            <img src={resolveImg(branding.logoUrl)} alt={branding.appName} className="h-8 w-8 rounded-md object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate" data-testid="text-app-name">{branding.appName}</p>
            {branding.tagline && <p className="text-xs text-muted-foreground truncate">{branding.tagline}</p>}
          </div>
          <Link href={orderingHref}>
            <button
              className="text-xs font-medium px-3 py-1.5 rounded-full text-white"
              style={{ backgroundColor: branding.primaryColor }}
              data-testid="button-header-order"
            >
              Order
            </button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pt-8 pb-12 text-white" style={heroStyle}>
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight" data-testid="text-hero-headline">
            {branding.heroHeadline}
          </h1>
          <p className="mt-2 text-base sm:text-lg text-white/90" data-testid="text-hero-subcopy">
            {branding.heroSubcopy}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={orderingHref}>
              <button
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white font-semibold shadow-sm"
                style={{ color: branding.primaryColor }}
                data-testid="button-hero-order"
              >
                <ShoppingBag className="w-4 h-4" /> Order now
              </button>
            </Link>
            <Link href={reserveHref}>
              <button
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold border border-white/40 text-white hover:bg-white/10"
                data-testid="button-hero-reserve"
              >
                Reserve a table
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Loyalty wallet strip */}
      {loyalty.enabled && (
        <section className="px-4 -mt-6 max-w-3xl mx-auto">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3" data-testid="card-loyalty">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${branding.accentColor}33`, color: branding.accentColor }}>
              <Award className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Loyalty wallet</p>
              <p className="text-xs text-muted-foreground">
                Earn {loyalty.pointsPerCurrencyUnit ?? 1} pt per {symbol}1 spent
                {loyalty.tiers && loyalty.tiers.length > 0 && ` · ${loyalty.tiers.map(t => t.name).join(" → ")}`}
              </p>
            </div>
            <Link href={orderingHref}>
              <button className="text-xs font-medium" style={{ color: branding.primaryColor }} data-testid="button-loyalty-cta">
                Start earning →
              </button>
            </Link>
          </div>
        </section>
      )}

      {/* App-exclusive coupons + apply-code */}
      <section className="px-4 mt-8 max-w-3xl mx-auto">
        <SectionHeading icon={Tag} accentColor={branding.accentColor}>App-only deals</SectionHeading>
        {coupons.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {coupons.map(c => (
              <div key={c.code} className="rounded-xl border border-dashed border-border bg-card p-4" data-testid={`card-coupon-${c.code}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold" style={{ color: branding.primaryColor }}>{c.code}</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {c.discountType === "percentage" ? `${c.discountValue}% off` : `${symbol}${c.discountValue} off`}
                  </span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mt-1">{c.description}</p>}
              </div>
            ))}
          </div>
        )}
        <CouponApplyCard
          restaurantId={restaurant.id}
          symbol={symbol}
          primaryColor={branding.primaryColor}
          orderingHref={orderingHref}
        />
      </section>

      {/* Menu */}
      {menu.categories.length > 0 && (
        <section className="px-4 mt-10 max-w-3xl mx-auto">
          <SectionHeading icon={Sparkles} accentColor={branding.accentColor}>Menu</SectionHeading>
          <div className="space-y-6 mt-3">
            {menu.categories.slice(0, 6).map(cat => (
              <div key={cat.id}>
                <p className="text-sm font-semibold mb-2">{cat.name}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {cat.items.slice(0, 6).map(it => (
                    <div key={it.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3" data-testid={`card-menu-${it.id}`}>
                      {it.imageUrl ? (
                        <img src={resolveImg(it.imageUrl)} alt={it.name} className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-md bg-muted flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{it.name}</p>
                        {it.description && <p className="text-xs text-muted-foreground line-clamp-1">{it.description}</p>}
                        <p className="text-xs font-semibold mt-1" style={{ color: branding.primaryColor }}>{symbol}{Number(it.price).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="text-center pt-2">
              <Link href={orderingHref}>
                <button className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: branding.primaryColor }} data-testid="button-view-full-menu">
                  View full menu <ArrowRight className="w-4 h-4" />
                </button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Gallery */}
      {branding.gallery.length > 0 && (
        <section className="px-4 mt-10 max-w-3xl mx-auto">
          <SectionHeading accentColor={branding.accentColor}>Gallery</SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {branding.gallery.map((src, i) => (
              <img
                key={i} src={resolveImg(src)} alt="" loading="lazy"
                className="aspect-square w-full object-cover rounded-lg border border-border"
                data-testid={`img-gallery-${i}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* About */}
      {branding.aboutBody && (
        <section className="px-4 mt-10 max-w-3xl mx-auto">
          <SectionHeading accentColor={branding.accentColor}>{branding.aboutTitle}</SectionHeading>
          <p className="text-sm text-muted-foreground whitespace-pre-line mt-3" data-testid="text-about-body">{branding.aboutBody}</p>
        </section>
      )}

      {/* Reviews widget */}
      {branding.reviewWidget.enabled && branding.reviewWidget.googleReviewLink && (
        <section className="px-4 mt-10 max-w-3xl mx-auto">
          <div className="rounded-xl border border-border bg-card p-5 text-center" data-testid="card-review-widget">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-2" style={{ backgroundColor: `${branding.accentColor}22`, color: branding.accentColor }}>
              <Star className="w-5 h-5" />
            </div>
            <p className="font-semibold">Loved your visit?</p>
            <p className="text-sm text-muted-foreground mt-1">A quick 5-star review goes a long way.</p>
            <a href={branding.reviewWidget.googleReviewLink} target="_blank" rel="noopener noreferrer">
              <button
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: branding.primaryColor }}
                data-testid="button-leave-review"
              >
                Leave a review
              </button>
            </a>
          </div>
        </section>
      )}

      {/* Contact */}
      <section className="px-4 mt-10 mb-12 max-w-3xl mx-auto">
        <SectionHeading accentColor={branding.accentColor}>Contact</SectionHeading>
        <div className="mt-3 space-y-2 text-sm">
          {branding.contactAddress && (
            <div className="flex items-start gap-2.5" data-testid="text-contact-address">
              <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <span>{branding.contactAddress}</span>
            </div>
          )}
          {branding.contactPhone && (
            <a href={`tel:${branding.contactPhone}`} className="flex items-center gap-2.5" data-testid="link-contact-phone">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span>{branding.contactPhone}</span>
            </a>
          )}
          {branding.contactEmail && (
            <a href={`mailto:${branding.contactEmail}`} className="flex items-center gap-2.5" data-testid="link-contact-email">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span>{branding.contactEmail}</span>
            </a>
          )}
        </div>
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Powered by <span className="font-medium">TableTrack</span>
      </footer>
    </div>
  );
}

function SectionHeading({ children, icon: Icon, accentColor }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; accentColor: string }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full" style={{ backgroundColor: `${accentColor}22`, color: accentColor }}>
          <Icon className="w-4 h-4" />
        </span>
      )}
      <h2 className="text-base font-semibold">{children}</h2>
    </div>
  );
}

function NoticePage({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center bg-card border border-border rounded-2xl p-8">
        <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center mb-3">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{body}</p>
      </div>
    </div>
  );
}

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setOg(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function CouponApplyCard({ restaurantId, symbol, primaryColor, orderingHref }: { restaurantId: number; symbol: string; primaryColor: string; orderingHref: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<{ code: string; discountType: string; discountValue: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onCheck() {
    if (!code.trim()) return;
    setBusy(true); setError(null); setValid(null);
    try {
      const res = await fetch(`${API_BASE}/public/restaurants/${restaurantId}/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Invalid coupon");
      setValid({ code: body.code, discountType: body.discountType, discountValue: body.discountValue });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid coupon");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium mb-2">Have a coupon code?</p>
      {valid ? (
        <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <div>
            <p className="font-mono text-sm font-semibold text-emerald-700">{valid.code}</p>
            <p className="text-xs text-emerald-600">
              {valid.discountType === "percentage" ? `${valid.discountValue}% off` : `${symbol}${Number(valid.discountValue).toFixed(2)} off`}
              {` — apply at checkout`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(valid.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
              }}
              className="text-xs font-medium px-2 py-1 rounded-md bg-white border border-emerald-300 text-emerald-700"
              data-testid="button-copy-coupon"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <Link href={orderingHref}>
              <button type="button" className="text-xs font-semibold px-3 py-1.5 rounded-md text-white" style={{ background: primaryColor }} data-testid="button-use-coupon">
                Order now
              </button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError(null); }}
            placeholder="Enter code"
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm uppercase tracking-wide bg-background focus:outline-none focus:ring-2"
            data-testid="input-coupon-code"
          />
          <button
            type="button"
            disabled={!code.trim() || busy}
            onClick={onCheck}
            className="text-sm font-semibold px-4 rounded-lg text-white disabled:opacity-50"
            style={{ background: primaryColor }}
            data-testid="button-apply-coupon"
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function setJsonLd(obj: unknown) {
  const id = "customer-app-jsonld";
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(obj);
}
