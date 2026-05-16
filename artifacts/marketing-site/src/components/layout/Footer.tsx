import { Link } from "wouter";
import { useAppSettings } from "@/lib/appSettings";
import { FOOTER_COLUMNS } from "@/lib/navigation";
import { COMPANY, LEGAL_LINKS } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Phone, MessageCircle, MapPin, ArrowRight } from "lucide-react";
import { useState } from "react";

const SOCIAL_LABELS: Record<string, string> = {
  twitter: "Twitter", linkedin: "LinkedIn", instagram: "Instagram",
  facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok",
};

export function Footer() {
  const settings = useAppSettings();
  const socialEntries = Object.entries(settings.socialLinks ?? {}).filter(([, v]) => !!v);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Newsletter Subscriber",
          email,
          sourcePage: "footer_newsletter",
          message: "Newsletter subscription",
          website: "",
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("ok"); setEmail("");
    } catch {
      setStatus("err");
    }
  };

  return (
    <footer className="bg-foreground text-background pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6">
        {/* Top: newsletter banner */}
        <div className="mb-14 rounded-2xl bg-gradient-to-br from-primary/20 via-orange-500/10 to-background/5 border border-white/10 p-8 md:p-10 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h3 className="font-serif text-2xl md:text-3xl font-bold mb-2">Restaurant operators read this every week.</h3>
            <p className="text-sm text-background/70 max-w-md">Playbooks on POS, kitchen ops, growth, AI and finance. No spam. Unsubscribe any time.</p>
          </div>
          <form onSubmit={subscribe} className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@restaurant.com"
              className="bg-background/10 border-background/20 text-background placeholder:text-background/50 flex-1"
              data-testid="input-newsletter-email"
            />
            <Button type="submit" disabled={status === "loading"} className="shrink-0" data-testid="btn-newsletter-subscribe">
              {status === "loading" ? "Subscribing…" : status === "ok" ? "Subscribed ✓" : <>Subscribe <ArrowRight className="ml-1.5 h-4 w-4" /></>}
            </Button>
          </form>
        </div>

        {/* Main columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-8">
          <div className="col-span-2 lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              {settings.logoUrl
                ? <img src={settings.logoUrl} alt={settings.appName} className="h-8 w-auto" />
                : <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-orange-500 flex items-center justify-center text-white font-bold">K</span>}
              <span className="font-serif text-2xl font-bold tracking-tight">{COMPANY.product}</span>
            </div>
            <p className="text-sm text-background/70 leading-relaxed max-w-xs">
              {COMPANY.productPositioning}. {COMPANY.proudlyBuiltLine}
            </p>
            <div className="space-y-2 text-sm text-background/70">
              <a href={`mailto:${COMPANY.supportEmail}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                <Mail className="h-4 w-4" /> {COMPANY.supportEmail}
              </a>
              <a href={COMPANY.phoneHref} className="flex items-center gap-2 hover:text-primary transition-colors">
                <Phone className="h-4 w-4" /> {COMPANY.phoneDisplay}
              </a>
              <a href={COMPANY.whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
                <MessageCircle className="h-4 w-4" /> WhatsApp {COMPANY.phoneDisplay}
              </a>
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{COMPANY.fullAddress}</span>
              </div>
            </div>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="space-y-3">
              <h4 className="font-semibold text-sm">{col.title}</h4>
              <ul className="space-y-2 text-sm text-background/70">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="hover:text-primary transition-colors">{l.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal: one-line horizontal row */}
        <div className="mt-12 pt-6 border-t border-white/10">
          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-background/60">
            {LEGAL_LINKS.map((l, i) => (
              <span key={l.href} className="flex items-center gap-5">
                <Link href={l.href} className="hover:text-primary transition-colors">{l.title}</Link>
                {i < LEGAL_LINKS.length - 1 && <span className="text-background/25" aria-hidden="true">·</span>}
              </span>
            ))}
          </nav>
        </div>

        {/* Bottom copyright row */}
        <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-background/60">
          <p>{COMPANY.copyrightLine}</p>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline text-background/50">A product of {COMPANY.legalName}, {COMPANY.city}</span>
            {socialEntries.length > 0 && (
              <div className="flex gap-4">
                {socialEntries.map(([key, url]) => (
                  <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                    {SOCIAL_LABELS[key] ?? key}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
