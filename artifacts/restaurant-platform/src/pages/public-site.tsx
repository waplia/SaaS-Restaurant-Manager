import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import {
  MapPin, Phone, Mail, Clock, Instagram, Facebook, Twitter, Youtube, Music2,
  ChevronRight, ChevronLeft, Calendar, AlertCircle, UtensilsCrossed, Search,
  X, Leaf, WheatOff, Star, Navigation, Menu as MenuIcon, ShoppingBag,
} from "lucide-react";

const API_BASE = "/api";

interface MenuItem {
  id: number; name: string; description: string | null;
  price: string; imageUrl: string | null;
  isVeg?: boolean; isVegan?: boolean; containsGluten?: boolean | null;
  tags?: string[]; allergens?: string[];
}
interface MenuCategory { id: number; name: string; items: MenuItem[] }

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
interface HoursEntry { open: string; close: string; closed: boolean; breakOpen?: string; breakClose?: string }
interface Testimonial { name: string; quote: string; rating: number; avatarUrl: string }

interface SiteCfg {
  enabled?: boolean;
  heroHeadline?: string; heroSubcopy?: string;
  socials?: { instagram?: string | null; facebook?: string | null; twitter?: string | null; youtube?: string | null; tiktok?: string | null };
  mapEmbedUrl?: string | null;
  seoTitle?: string; seoDescription?: string; ogImageUrl?: string | null;
  accentColor?: string;
  ctaPrimaryLabel?: string; ctaSecondaryLabel?: string; ctaReserveLabel?: string;
  showOpenClosedPill?: boolean;
  testimonials?: Testimonial[];
  analyticsGa4?: string; analyticsFbPixel?: string;
  orderingEnabled?: boolean;
}
interface AboutCfg {
  story?: string; mission?: string; heroImage?: string;
  gallery?: string[]; awards?: string;
  team?: Array<{ name: string; role: string; photoUrl: string }>;
}
interface SiteResponse {
  restaurant: { id: number; name: string; slug: string; logoUrl: string | null; currency: string; address: string | null; phone: string | null; email: string | null; timezone: string };
  site: SiteCfg;
  about: AboutCfg;
  hours: Record<DayKey, HoursEntry> | null;
  openStatus: { isOpen: boolean; today: HoursEntry; weekday: DayKey } | null;
  menu: { categories: MenuCategory[]; featured: MenuItem[] };
}

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

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

function setFavicon(href: string): void {
  if (!href) return;
  let el = document.head.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    document.head.appendChild(el);
  }
  el.href = href;
}

function setCanonical(href: string): void {
  if (!href) return;
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

function nextOpenInfo(hours: Record<DayKey, HoursEntry> | null, weekday: DayKey, nowMin: number): string | null {
  if (!hours) return null;
  const order: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const labels: Record<DayKey, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  const toMin = (s: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1; };
  const todayIdx = order.indexOf(weekday);
  const today = hours[weekday];
  if (today && !today.closed) {
    const openMin = toMin(today.open);
    const bo = today.breakOpen ? toMin(today.breakOpen) : -1;
    const bc = today.breakClose ? toMin(today.breakClose) : -1;
    if (openMin > nowMin) return `Opens today at ${fmtTime12(today.open)}`;
    if (bo >= 0 && bc >= 0 && nowMin >= bo && nowMin < bc) return `Reopens today at ${fmtTime12(today.breakClose!)}`;
  }
  for (let i = 1; i <= 7; i++) {
    const d = order[(todayIdx + i) % 7];
    const h = hours[d];
    if (h && !h.closed && h.open) {
      const label = i === 1 ? "tomorrow" : labels[d];
      return `Opens ${label} at ${fmtTime12(h.open)}`;
    }
  }
  return null;
}

function fmtTime12(s: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return s;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return min === "00" ? `${h12} ${period}` : `${h12}:${min} ${period}`;
}

export default function PublicSitePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const [data, setData] = useState<SiteResponse | null>(null);
  const [error, setError] = useState<{ message: string; code?: string; restaurantName?: string } | null>(null);
  const [activeSection, setActiveSection] = useState<string>("home");
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [menuQuery, setMenuQuery] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const categoryBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/public/site/${encodeURIComponent(slug)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string; code?: string; restaurantName?: string };
          throw Object.assign(new Error(body.error ?? "Site not available"), { code: body.code, restaurantName: body.restaurantName });
        }
        return r.json() as Promise<SiteResponse>;
      })
      .then(setData)
      .catch((e: Error & { code?: string; restaurantName?: string }) => setError({ message: e.message, code: e.code, restaurantName: e.restaurantName }));
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
    const desc = data.site.seoDescription?.trim() || `Visit ${data.restaurant.name}. View our menu, hours, location, and book a table online.`;
    setMeta("description", desc);
    setMeta("og:title", title, "property");
    setMeta("og:description", desc, "property");
    setMeta("og:type", "restaurant.restaurant", "property");
    setMeta("og:site_name", data.restaurant.name, "property");
    const og = data.site.ogImageUrl?.trim() || resolveImg(data.about.heroImage) || resolveImg(data.restaurant.logoUrl);
    if (og) {
      setMeta("og:image", og, "property");
      setMeta("twitter:image", og);
    }
    setMeta("twitter:card", og ? "summary_large_image" : "summary");
    setMeta("twitter:title", title);
    setMeta("twitter:description", desc);
    const favicon = resolveImg(data.restaurant.logoUrl);
    if (favicon) setFavicon(favicon);
    setCanonical(window.location.origin + window.location.pathname);
  }, [data]);

  // Lightbox keyboard nav
  useEffect(() => {
    if (lightboxIndex === null) return;
    const gallery = data?.about.gallery ?? [];
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowRight") setLightboxIndex(i => i === null ? null : (i + 1) % gallery.length);
      else if (e.key === "ArrowLeft") setLightboxIndex(i => i === null ? null : (i - 1 + gallery.length) % gallery.length);
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxIndex, data?.about.gallery]);

  // Section scroll-spy
  useEffect(() => {
    if (!data) return;
    function onScroll() {
      const ids = ["home", "menu", "about", "gallery", "visit"];
      let current = "home";
      for (const id of ids) {
        const el = document.getElementById(`section-${id}`);
        if (el && el.getBoundingClientRect().top <= 120) current = id;
      }
      setActiveSection(current);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [data]);

  const allCategories = useMemo(
    () => (data?.menu.categories ?? []).filter(c => c.items.length > 0),
    [data],
  );

  const filteredCategories = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    if (!q) return allCategories;
    return allCategories
      .map(c => ({
        ...c,
        items: c.items.filter(i =>
          i.name.toLowerCase().includes(q)
          || (i.description ?? "").toLowerCase().includes(q)
          || (i.tags ?? []).some(t => t.toLowerCase().includes(q))
        ),
      }))
      .filter(c => c.items.length > 0);
  }, [allCategories, menuQuery]);

  if (error) {
    const notPublished = error.code === "site_not_published";
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md text-center">
          {notPublished ? (
            <>
              <UtensilsCrossed className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-semibold text-lg">{error.restaurantName ?? "This site"} isn’t published yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                The owner is still setting things up. Please check back soon for the menu, hours and reservations.
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-3" />
              <p className="font-semibold">Site not available</p>
              <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-14 border-b border-border bg-muted/30 animate-pulse" />
        <div className="max-w-6xl mx-auto px-6 py-16 space-y-6">
          <div className="h-72 rounded-2xl bg-muted animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[0, 1, 2].map(i => <div key={i} className="h-56 rounded-2xl bg-muted animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  const { restaurant, site, about, hours, openStatus, menu } = data;
  const accent = site.accentColor?.trim() || "#c2410c";
  const sym = currSymbol(restaurant.currency);
  const heroImg = resolveImg(about.heroImage);
  const featured = menu.featured;
  const gallery = about.gallery ?? [];
  const testimonials = (site.testimonials ?? []).filter(t => t.name && t.quote);

  const ctaPrimary = site.ctaPrimaryLabel?.trim() || "Reserve a table";
  const ctaSecondary = site.ctaSecondaryLabel?.trim() || "View menu";
  const ctaReserve = site.ctaReserveLabel?.trim() || "Book a table";
  const showPill = site.showOpenClosedPill !== false && openStatus !== null;
  const nowMinForOpens = (() => {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: restaurant.timezone || "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
      const parts = fmt.formatToParts(new Date());
      const hh = parts.find(p => p.type === "hour")?.value ?? "00";
      const mm = parts.find(p => p.type === "minute")?.value ?? "00";
      return parseInt(hh, 10) * 60 + parseInt(mm, 10);
    } catch { return 0; }
  })();
  const opensAtText = (showPill && openStatus && !openStatus.isOpen)
    ? nextOpenInfo(hours, openStatus.weekday, nowMinForOpens)
    : null;
  const showOrderCta = site.orderingEnabled === true;

  const sections = [
    { id: "home", label: "Home" },
    { id: "menu", label: "Menu" },
    { id: "about", label: "About" },
    ...(gallery.length > 0 ? [{ id: "gallery", label: "Gallery" }] : []),
    { id: "visit", label: "Visit" },
  ];

  function scrollToSection(id: string) {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToCategory(catId: number) {
    setActiveCategory(catId);
    const el = document.getElementById(`category-${catId}`);
    if (el) {
      const headerOffset = 120;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerOffset, behavior: "smooth" });
    }
  }

  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const bookingPath = `${base}/book/${restaurant.slug}`;
  const directionsHref = restaurant.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(restaurant.address)}`
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    description: site.seoDescription?.trim() || about.mission?.trim() || undefined,
    image: site.ogImageUrl || heroImg || resolveImg(restaurant.logoUrl) || undefined,
    address: restaurant.address ? { "@type": "PostalAddress", streetAddress: restaurant.address } : undefined,
    telephone: restaurant.phone || undefined,
    email: restaurant.email || undefined,
    priceRange: "$$",
    servesCuisine: undefined,
    openingHoursSpecification: hours ? DAY_ORDER.map(d => {
      const h = hours[d];
      if (!h || h.closed || !h.open || !h.close) return null;
      const dayMap: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
      return {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: dayMap[d],
        opens: h.open,
        closes: h.close,
      };
    }).filter(Boolean) : undefined,
    sameAs: Object.values(site.socials ?? {}).filter((v): v is string => typeof v === "string" && v.length > 0),
  };

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ ["--site-accent" as string]: accent } as React.CSSProperties}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") }} />

      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <button onClick={() => scrollToSection("home")} className="flex items-center gap-2 font-bold text-base sm:text-lg min-w-0">
            {restaurant.logoUrl
              ? <img src={resolveImg(restaurant.logoUrl)} alt="" width={32} height={32} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
              : <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: accent }}>{restaurant.name[0]}</span>}
            <span className="truncate max-w-[140px] sm:max-w-[220px]">{restaurant.name}</span>
            {showPill && (
              <span
                className={`hidden sm:inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-semibold ml-1 ${openStatus.isOpen ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                title={!openStatus.isOpen && opensAtText ? opensAtText : undefined}>
                <span className={`w-1.5 h-1.5 rounded-full ${openStatus.isOpen ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                {openStatus.isOpen ? "Open now" : (opensAtText ?? "Closed")}
              </span>
            )}
          </button>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {sections.map(s => (
              <button key={s.id} onClick={() => scrollToSection(s.id)}
                className={`px-3 py-1.5 rounded-md transition-colors ${activeSection === s.id ? "text-[var(--site-accent)] font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 flex-shrink-0">
            {showOrderCta && (
              <Link href={`${base}/menu/${restaurant.slug}`}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold border border-border bg-background hover:bg-accent">
                <ShoppingBag className="w-4 h-4" /> Order
              </Link>
            )}
            <Link href={`/book/${restaurant.slug}`}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-full text-sm font-semibold text-white shadow-sm hover:opacity-95"
              style={{ background: accent }}>
              <Calendar className="w-4 h-4" /> <span className="hidden sm:inline">{ctaReserve}</span><span className="sm:hidden">Book</span>
            </Link>
            <button
              type="button" onClick={() => setMobileNavOpen(true)}
              className="md:hidden w-9 h-9 rounded-md border border-border flex items-center justify-center hover:bg-accent"
              aria-label="Open menu">
              <MenuIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {showPill && (
          <div className="sm:hidden border-t border-border bg-muted/30">
            <div className="max-w-6xl mx-auto px-4 h-7 flex items-center text-[11px] font-semibold gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${openStatus.isOpen ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              <span className={openStatus.isOpen ? "text-emerald-700" : "text-muted-foreground"}>
                {openStatus.isOpen ? "Open now" : (opensAtText ?? "Closed")}
              </span>
            </div>
          </div>
        )}
      </header>

      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileNavOpen(false)} role="dialog" aria-modal="true">
          <div className="absolute right-0 top-0 bottom-0 w-72 max-w-[85%] bg-background shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="font-bold">{restaurant.name}</span>
              <button onClick={() => setMobileNavOpen(false)} className="w-9 h-9 rounded-md hover:bg-accent flex items-center justify-center" aria-label="Close menu">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {sections.map(s => (
                <button key={s.id}
                  onClick={() => { setMobileNavOpen(false); scrollToSection(s.id); }}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm ${activeSection === s.id ? "bg-muted font-semibold text-[var(--site-accent)]" : "hover:bg-muted/60"}`}>
                  {s.label}
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-border space-y-2">
              {showOrderCta && (
                <Link href={`${base}/menu/${restaurant.slug}`}
                  onClick={() => setMobileNavOpen(false)}
                  className="flex items-center justify-center gap-2 w-full h-11 rounded-full font-semibold border border-border hover:bg-accent">
                  <ShoppingBag className="w-4 h-4" /> Order online
                </Link>
              )}
              <Link href={`/book/${restaurant.slug}`}
                onClick={() => setMobileNavOpen(false)}
                className="flex items-center justify-center gap-2 w-full h-11 rounded-full font-semibold text-white shadow-sm"
                style={{ background: accent }}>
                <Calendar className="w-4 h-4" /> {ctaReserve}
              </Link>
            </div>
          </div>
        </div>
      )}

      <section id="section-home" className="relative">
        {heroImg && (
          <img src={heroImg} alt="" className="absolute inset-0 w-full h-full object-cover" aria-hidden fetchPriority="high" />
        )}
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
              <Calendar className="w-4 h-4" /> {ctaPrimary}
            </Link>
            <button onClick={() => scrollToSection("menu")}
              className="inline-flex items-center gap-2 px-6 h-11 rounded-full font-semibold bg-white/95 text-gray-900 hover:bg-white">
              <UtensilsCrossed className="w-4 h-4" /> {ctaSecondary}
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
                  ? <img src={resolveImg(item.imageUrl)} alt={item.name} width={400} height={300} className="w-full h-48 object-cover" loading="lazy" />
                  : <div className="w-full h-48 bg-muted" aria-hidden />}
                <div className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold text-base">{item.name}</h3>
                    <span className="font-semibold text-sm whitespace-nowrap" style={{ color: accent }}>{sym}{Number(item.price).toFixed(2)}</span>
                  </div>
                  <DietBadges item={item} />
                  {item.description && <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3">{item.description}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section id="section-menu" className="bg-muted/30 border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-6">Our Menu</h2>

          {allCategories.length === 0 ? (
            <p className="text-center text-muted-foreground">Menu coming soon.</p>
          ) : (
            <>
              <div className="max-w-md mx-auto mb-6 relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search" value={menuQuery} onChange={e => setMenuQuery(e.target.value)}
                  placeholder="Search dishes, ingredients, tags…"
                  className="w-full h-11 pl-10 pr-10 rounded-full border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
                  style={{ ["--tw-ring-color" as string]: accent } as React.CSSProperties}
                />
                {menuQuery && (
                  <button onClick={() => setMenuQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {!menuQuery && allCategories.length > 1 && (
                <div ref={categoryBarRef} className="sticky top-14 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 mb-8 bg-muted/80 backdrop-blur border-y border-border">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                    {allCategories.map(c => (
                      <button key={c.id} onClick={() => scrollToCategory(c.id)}
                        className={`flex-shrink-0 px-3.5 h-8 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${activeCategory === c.id ? "text-white" : "bg-background hover:bg-accent text-foreground border border-border"}`}
                        style={activeCategory === c.id ? { background: accent } : undefined}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredCategories.length === 0 ? (
                <p className="text-center text-muted-foreground py-6">No dishes match "{menuQuery}".</p>
              ) : (
                <div className="space-y-12">
                  {filteredCategories.map(cat => (
                    <div key={cat.id} id={`category-${cat.id}`}>
                      <h3 className="text-xl font-bold mb-5 pb-2 border-b-2" style={{ borderColor: accent }}>{cat.name}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {cat.items.map(item => (
                          <div key={item.id} className="flex gap-4 bg-card border border-border rounded-xl p-3 hover:shadow-sm transition-shadow">
                            {item.imageUrl && (
                              <img src={resolveImg(item.imageUrl)} alt={item.name} width={96} height={96} className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <h4 className="font-semibold truncate">{item.name}</h4>
                                <span className="font-semibold text-sm whitespace-nowrap" style={{ color: accent }}>{sym}{Number(item.price).toFixed(2)}</span>
                              </div>
                              <DietBadges item={item} />
                              {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>}
                              {(item.allergens?.length ?? 0) > 0 && (
                                <p className="text-[11px] text-muted-foreground mt-1.5"><span className="font-semibold">Contains:</span> {item.allergens!.join(", ")}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
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
                        ? <img src={resolveImg(m.photoUrl)} alt={m.name} width={80} height={80} className="w-20 h-20 mx-auto rounded-full object-cover mb-2" loading="lazy" />
                        : <div className="w-20 h-20 mx-auto rounded-full bg-muted mb-2" aria-hidden />}
                      <p className="text-sm font-semibold">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.role}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : heroImg ? (
              <img src={heroImg} alt="" width={800} height={600} className="w-full rounded-2xl object-cover aspect-[4/3]" loading="lazy" />
            ) : null}
          </div>
        </div>
      </section>

      {testimonials.length > 0 && (
        <section className="bg-muted/30 border-y border-border">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">What guests say</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {testimonials.map((t, i) => (
                <figure key={i} className="bg-card border border-border rounded-2xl p-5 flex flex-col">
                  <div className="flex items-center gap-0.5 mb-2" aria-label={`${t.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star key={j} className="w-4 h-4" style={{ color: j < t.rating ? accent : "var(--muted-foreground)" }}
                        fill={j < t.rating ? accent : "none"} />
                    ))}
                  </div>
                  <blockquote className="text-sm text-foreground/85 leading-relaxed flex-1">"{t.quote}"</blockquote>
                  <figcaption className="flex items-center gap-2.5 mt-4 pt-4 border-t border-border">
                    {t.avatarUrl
                      ? <img src={resolveImg(t.avatarUrl)} alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover" loading="lazy" />
                      : <span className="w-9 h-9 rounded-full bg-muted text-xs font-semibold flex items-center justify-center text-muted-foreground">{t.name[0]?.toUpperCase() ?? "?"}</span>}
                    <span className="text-sm font-semibold">{t.name}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {gallery.length > 0 && (
        <section id="section-gallery" className="bg-muted/20 border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Gallery</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {gallery.map((url, i) => (
                <button key={i} onClick={() => setLightboxIndex(i)} className="block aspect-square overflow-hidden rounded-xl bg-muted group">
                  <img src={resolveImg(url)} alt="" width={300} height={300} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                </button>
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
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Address</p>
                  <p className="text-sm leading-relaxed">{restaurant.address}</p>
                  {directionsHref && (
                    <a href={directionsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs mt-1 hover:underline" style={{ color: accent }}>
                      <Navigation className="w-3 h-3" /> Get directions
                    </a>
                  )}
                </div>
              </div>
            )}
            {restaurant.phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Phone</p>
                  <a href={`tel:${restaurant.phone.replace(/[^\d+]/g, "")}`} className="text-sm hover:underline">{restaurant.phone}</a>
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
                      {DAY_ORDER.map(d => {
                        const h = hours[d];
                        const isToday = openStatus?.weekday === d;
                        return (
                          <tr key={d} className={isToday ? "font-semibold" : ""}>
                            <td className="pr-6 py-0.5 text-muted-foreground">{DAY_LABELS[d]}{isToday ? " (today)" : ""}</td>
                            <td className="py-0.5">
                              {!h || h.closed || !h.open || !h.close
                                ? <span className="text-muted-foreground">Closed</span>
                                : h.breakOpen && h.breakClose
                                  ? `${fmtTime12(h.open)} – ${fmtTime12(h.breakOpen)}, ${fmtTime12(h.breakClose)} – ${fmtTime12(h.close)}`
                                  : `${fmtTime12(h.open)} – ${fmtTime12(h.close)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <SocialLinks socials={site.socials ?? {}} />
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
            <Link href={bookingPath}
              className="flex items-center justify-between gap-2 w-full px-5 h-12 rounded-xl font-semibold text-white shadow-sm hover:opacity-95"
              style={{ background: accent }}>
              <span className="flex items-center gap-2"><Calendar className="w-4 h-4" /> {ctaPrimary}</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 font-bold text-base">
              {restaurant.logoUrl
                ? <img src={resolveImg(restaurant.logoUrl)} alt="" width={28} height={28} className="w-7 h-7 rounded object-cover" />
                : <span className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{ background: accent }}>{restaurant.name[0]}</span>}
              {restaurant.name}
            </div>
            {restaurant.address && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{restaurant.address}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick links</p>
            <ul className="space-y-1.5 text-sm">
              {sections.map(s => (
                <li key={s.id}>
                  <button onClick={() => scrollToSection(s.id)} className="hover:underline text-foreground/80 hover:text-foreground">{s.label}</button>
                </li>
              ))}
              <li><Link href={`/book/${restaurant.slug}`} className="hover:underline text-foreground/80 hover:text-foreground">{ctaReserve}</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Follow</p>
            <SocialLinks socials={site.socials ?? {}} />
          </div>
        </div>
        <div className="border-t border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {restaurant.name}. All rights reserved.</p>
            <p>Powered by <span className="font-semibold text-foreground/80">TableTrack</span></p>
          </div>
        </div>
      </footer>

      {lightboxIndex !== null && gallery[lightboxIndex] && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxIndex(null)} role="dialog" aria-modal="true">
          <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
          {gallery.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i === null ? null : (i - 1 + gallery.length) % gallery.length); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" aria-label="Previous">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i === null ? null : (i + 1) % gallery.length); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" aria-label="Next">
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
          <img src={resolveImg(gallery[lightboxIndex])} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function DietBadges({ item }: { item: MenuItem }) {
  const badges: Array<{ label: string; icon: React.ReactNode; cls: string }> = [];
  if (item.isVegan) badges.push({ label: "Vegan", icon: <Leaf className="w-3 h-3" />, cls: "bg-emerald-100 text-emerald-700" });
  else if (item.isVeg) badges.push({ label: "Veg", icon: <Leaf className="w-3 h-3" />, cls: "bg-green-100 text-green-700" });
  if (item.containsGluten === false) badges.push({ label: "Gluten-free", icon: <WheatOff className="w-3 h-3" />, cls: "bg-amber-100 text-amber-700" });
  for (const t of item.tags ?? []) {
    if (t && badges.length < 4) badges.push({ label: t, icon: null, cls: "bg-muted text-foreground/70" });
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {badges.map((b, i) => (
        <span key={i} className={`inline-flex items-center gap-0.5 px-1.5 h-5 rounded-full text-[10px] font-medium ${b.cls}`}>
          {b.icon}{b.label}
        </span>
      ))}
    </div>
  );
}

function SocialLinks({ socials }: { socials: { instagram?: string | null; facebook?: string | null; twitter?: string | null; youtube?: string | null; tiktok?: string | null } }) {
  const links: Array<{ url: string; label: string; icon: React.ReactNode }> = [];
  if (socials.instagram) links.push({ url: socials.instagram, label: "Instagram", icon: <Instagram className="w-4 h-4" /> });
  if (socials.facebook) links.push({ url: socials.facebook, label: "Facebook", icon: <Facebook className="w-4 h-4" /> });
  if (socials.twitter) links.push({ url: socials.twitter, label: "Twitter", icon: <Twitter className="w-4 h-4" /> });
  if (socials.youtube) links.push({ url: socials.youtube, label: "YouTube", icon: <Youtube className="w-4 h-4" /> });
  if (socials.tiktok) links.push({ url: socials.tiktok, label: "TikTok", icon: <Music2 className="w-4 h-4" /> });
  if (links.length === 0) return null;
  return (
    <div className="flex items-center gap-2 pt-1">
      {links.map(l => (
        <a key={l.label} href={l.url} target="_blank" rel="noreferrer" aria-label={l.label}
          className="w-10 h-10 rounded-full bg-muted hover:bg-accent flex items-center justify-center transition-colors">
          {l.icon}
        </a>
      ))}
    </div>
  );
}
