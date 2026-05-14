import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { MapPin, Phone, Mail, Clock, Instagram, Facebook, Twitter, ChevronRight, Calendar, AlertCircle, UtensilsCrossed } from "lucide-react";

const API_BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "") + "/api";

interface MenuItem { id: number; name: string; description: string | null; price: string; imageUrl: string | null }
interface MenuCategory { id: number; name: string; items: MenuItem[] }
interface DayHours { open: boolean; from: string; to: string; breakFrom?: string; breakTo?: string }
interface SiteCfg {
  enabled?: boolean;
  heroHeadline?: string; heroSubcopy?: string;
  socials?: { instagram?: string; facebook?: string; twitter?: string };
  mapEmbedUrl?: string;
  seoTitle?: string; seoDescription?: string; ogImageUrl?: string;
  accentColor?: string;
}
interface AboutCfg {
  story?: string; mission?: string; heroImage?: string;
  gallery?: string[]; awards?: string;
  team?: Array<{ name: string; role: string; photoUrl: string }>;
}
interface SiteResponse {
  restaurant: { id: number; name: string; slug: string; logoUrl: string | null; currency: string; address: string | null; phone: string | null; email: string | null };
  site: SiteCfg;
  about: AboutCfg;
  hours: Record<string, DayHours> | null;
  menu: { categories: MenuCategory[]; featured: MenuItem[] };
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

function currSymbol(c: string): string {
  return c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "₹";
}

function resolveImg(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/objects/")) return `${API_BASE}/public/storage${url}`;
  return url;
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name"): void {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export default function PublicSitePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const [data, setData] = useState<SiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("home");

  useEffect(() => {
    fetch(`${API_BASE}/public/site/${encodeURIComponent(slug)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Site not available");
        return r.json() as Promise<SiteResponse>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; site?: Partial<SiteCfg>; about?: Partial<AboutCfg> } | null;
      if (!msg || msg.type !== "tabletrack:public-site:preview") return;
      setData(prev => prev ? {
        ...prev,
        site: { ...prev.site, ...(msg.site ?? {}) },
        about: { ...prev.about, ...(msg.about ?? {}) },
      } : prev);
    }
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "tabletrack:public-site:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!data) return;
    const title = data.site.seoTitle?.trim() || `${data.restaurant.name} — Menu, Hours & Reservations`;
    document.title = title;
    setMeta("description", data.site.seoDescription?.trim() || `Visit ${data.restaurant.name}. View our menu, hours, location, and book a table online.`);
    setMeta("og:title", title, "property");
    setMeta("og:description", data.site.seoDescription?.trim() || `Visit ${data.restaurant.name}.`, "property");
    setMeta("og:type", "restaurant.restaurant", "property");
    const og = data.site.ogImageUrl?.trim() || resolveImg(data.about.heroImage) || resolveImg(data.restaurant.logoUrl);
    if (og) setMeta("og:image", og, "property");
  }, [data]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-3" />
          <p className="font-semibold">Site not available</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  const { restaurant, site, about, hours, menu } = data;
  const accent = site.accentColor?.trim() || "#c2410c";
  const sym = currSymbol(restaurant.currency);
  const heroImg = resolveImg(about.heroImage);
  const featured = menu.featured;
  const allCategories = menu.categories.filter(c => c.items.length > 0);

  const sections = [
    { id: "home", label: "Home" },
    { id: "menu", label: "Menu" },
    { id: "about", label: "About" },
    ...(about.gallery && about.gallery.length > 0 ? [{ id: "gallery", label: "Gallery" }] : []),
    { id: "visit", label: "Visit" },
  ];

  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const bookingPath = `${(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "")}/book/${restaurant.slug}`;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ ["--site-accent" as string]: accent } as React.CSSProperties}>
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button onClick={() => scrollTo("home")} className="flex items-center gap-2 font-bold text-base sm:text-lg">
            {restaurant.logoUrl
              ? <img src={resolveImg(restaurant.logoUrl)} alt="" className="w-8 h-8 rounded-lg object-cover" />
              : <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: accent }}>{restaurant.name[0]}</span>}
            <span className="truncate max-w-[180px]">{restaurant.name}</span>
          </button>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {sections.map(s => (
              <button key={s.id} onClick={() => scrollTo(s.id)}
                className={`px-3 py-1.5 rounded-md transition-colors ${activeSection === s.id ? "text-[var(--site-accent)] font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </nav>
          <Link href={`/book/${restaurant.slug}`}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-full text-sm font-semibold text-white shadow-sm hover:opacity-95"
            style={{ background: accent }}>
            <Calendar className="w-4 h-4" /> <span className="hidden sm:inline">Book a table</span><span className="sm:hidden">Book</span>
          </Link>
        </div>
      </header>

      <section id="section-home" className="relative">
        {heroImg && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroImg})` }} aria-hidden />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/45 to-black/70" aria-hidden />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-24 sm:py-36 text-center text-white">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight drop-shadow">
            {site.heroHeadline?.trim() || restaurant.name}
          </h1>
          {(site.heroSubcopy?.trim() || about.mission?.trim()) && (
            <p className="mt-4 sm:mt-6 text-base sm:text-xl text-white/90 max-w-2xl mx-auto leading-relaxed">
              {site.heroSubcopy?.trim() || about.mission?.trim()}
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={`/book/${restaurant.slug}`}
              className="inline-flex items-center gap-2 px-6 h-11 rounded-full font-semibold text-white shadow-lg hover:opacity-95"
              style={{ background: accent }}>
              <Calendar className="w-4 h-4" /> Reserve a table
            </Link>
            <button onClick={() => scrollTo("menu")}
              className="inline-flex items-center gap-2 px-6 h-11 rounded-full font-semibold bg-white/95 text-gray-900 hover:bg-white">
              <UtensilsCrossed className="w-4 h-4" /> View menu
            </button>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Featured</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featured.map(item => (
              <article key={item.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                {item.imageUrl
                  ? <img src={resolveImg(item.imageUrl)} alt={item.name} className="w-full h-48 object-cover" loading="lazy" />
                  : <div className="w-full h-48 bg-muted" />}
                <div className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold text-base">{item.name}</h3>
                    <span className="font-semibold text-sm whitespace-nowrap" style={{ color: accent }}>{sym}{Number(item.price).toFixed(2)}</span>
                  </div>
                  {item.description && <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3">{item.description}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section id="section-menu" className="bg-muted/30 border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Our Menu</h2>
          {allCategories.length === 0 ? (
            <p className="text-center text-muted-foreground">Menu coming soon.</p>
          ) : (
            <div className="space-y-12">
              {allCategories.map(cat => (
                <div key={cat.id}>
                  <h3 className="text-xl font-bold mb-5 pb-2 border-b-2" style={{ borderColor: accent }}>{cat.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {cat.items.map(item => (
                      <div key={item.id} className="flex gap-4 bg-card border border-border rounded-xl p-3 hover:shadow-sm transition-shadow">
                        {item.imageUrl && (
                          <img src={resolveImg(item.imageUrl)} alt={item.name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="font-semibold truncate">{item.name}</h4>
                            <span className="font-semibold text-sm whitespace-nowrap" style={{ color: accent }}>{sym}{Number(item.price).toFixed(2)}</span>
                          </div>
                          {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="section-about" className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">About Us</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
          <div>
            {about.story?.trim() ? (
              <p className="text-base leading-relaxed whitespace-pre-line text-foreground/90">{about.story}</p>
            ) : (
              <p className="text-muted-foreground italic">Our story is being written…</p>
            )}
            {about.awards?.trim() && (
              <div className="mt-6 p-4 rounded-xl border-l-4 bg-muted/40" style={{ borderColor: accent }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: accent }}>Awards & Recognition</p>
                <p className="text-sm text-foreground/85 whitespace-pre-line">{about.awards}</p>
              </div>
            )}
          </div>
          <div>
            {about.team && about.team.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Meet the team</p>
                <div className="grid grid-cols-2 gap-4">
                  {about.team.map((m, i) => (
                    <div key={i} className="text-center">
                      {m.photoUrl
                        ? <img src={resolveImg(m.photoUrl)} alt={m.name} className="w-20 h-20 mx-auto rounded-full object-cover mb-2" loading="lazy" />
                        : <div className="w-20 h-20 mx-auto rounded-full bg-muted mb-2" />}
                      <p className="text-sm font-semibold">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.role}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : heroImg ? (
              <img src={heroImg} alt="" className="w-full rounded-2xl object-cover aspect-[4/3]" loading="lazy" />
            ) : null}
          </div>
        </div>
      </section>

      {about.gallery && about.gallery.length > 0 && (
        <section id="section-gallery" className="bg-muted/30 border-y border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Gallery</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {about.gallery.map((url, i) => (
                <a key={i} href={resolveImg(url)} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl bg-muted">
                  <img src={resolveImg(url)} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="section-visit" className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Visit Us</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-5">
            {restaurant.address && (
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Address</p>
                  <p className="text-sm leading-relaxed">{restaurant.address}</p>
                </div>
              </div>
            )}
            {restaurant.phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Phone</p>
                  <a href={`tel:${restaurant.phone}`} className="text-sm hover:underline">{restaurant.phone}</a>
                </div>
              </div>
            )}
            {restaurant.email && (
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Email</p>
                  <a href={`mailto:${restaurant.email}`} className="text-sm hover:underline">{restaurant.email}</a>
                </div>
              </div>
            )}
            {hours && (
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Hours</p>
                  <table className="text-sm">
                    <tbody>
                      {DAYS.map(d => {
                        const h = hours[d];
                        return (
                          <tr key={d}>
                            <td className="pr-6 py-0.5 text-muted-foreground">{DAY_LABELS[d]}</td>
                            <td className="py-0.5">
                              {!h || !h.open
                                ? <span className="text-muted-foreground">Closed</span>
                                : h.breakFrom && h.breakTo
                                  ? `${h.from}–${h.breakFrom}, ${h.breakTo}–${h.to}`
                                  : `${h.from}–${h.to}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(site.socials?.instagram || site.socials?.facebook || site.socials?.twitter) && (
              <div className="flex items-center gap-2 pt-2">
                {site.socials?.instagram && (
                  <a href={site.socials.instagram} target="_blank" rel="noreferrer" aria-label="Instagram"
                    className="w-10 h-10 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors">
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {site.socials?.facebook && (
                  <a href={site.socials.facebook} target="_blank" rel="noreferrer" aria-label="Facebook"
                    className="w-10 h-10 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors">
                    <Facebook className="w-4 h-4" />
                  </a>
                )}
                {site.socials?.twitter && (
                  <a href={site.socials.twitter} target="_blank" rel="noreferrer" aria-label="Twitter"
                    className="w-10 h-10 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors">
                    <Twitter className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="space-y-4">
            {site.mapEmbedUrl?.trim() ? (
              <div className="aspect-[4/3] w-full rounded-2xl overflow-hidden border border-border bg-muted">
                <iframe src={site.mapEmbedUrl} className="w-full h-full" loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade" title={`Map to ${restaurant.name}`} />
              </div>
            ) : (
              <div className="aspect-[4/3] w-full rounded-2xl border border-dashed border-border bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
                Map coming soon
              </div>
            )}
            <Link href={bookingPath} target="_blank"
              className="flex items-center justify-between gap-2 w-full px-5 h-12 rounded-xl font-semibold text-white shadow-sm hover:opacity-95"
              style={{ background: accent }}>
              <span className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Reserve a table online</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} {restaurant.name}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
