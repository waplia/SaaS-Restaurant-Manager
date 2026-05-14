import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { CalendarDays, Clock, Users, CheckCircle2, AlertCircle, Search, ArrowLeft, Phone, Mail, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "") + "/api";

async function publicGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Request failed");
  return r.json();
}
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Request failed");
  return r.json();
}

interface RestaurantInfo { id: number; name: string; slug: string; logoUrl: string | null; currency: string }
interface Lookup { id: number; guestName: string; partySize: number; scheduledAt: string; status: string; notes: string | null }
interface ReservationConfirmation { id: number; status: string; guestName: string; partySize: number; scheduledAt: string; restaurantName: string }

const STATUS_LABEL: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: "Pending confirmation", bg: "bg-yellow-100", text: "text-yellow-800" },
  confirmed: { label: "Confirmed", bg: "bg-blue-100", text: "text-blue-800" },
  seated: { label: "Seated", bg: "bg-orange-100", text: "text-orange-800" },
  completed: { label: "Completed", bg: "bg-green-100", text: "text-green-800" },
  cancelled: { label: "Cancelled", bg: "bg-gray-100", text: "text-gray-700" },
  no_show: { label: "No-show", bg: "bg-red-100", text: "text-red-800" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function PublicBookingPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"book" | "lookup">("book");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<ReservationConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    guestName: "", guestPhone: "", guestEmail: "",
    partySize: 2, date: "", time: "19:00", notes: "",
  });

  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupDate, setLookupDate] = useState("");
  const [lookupResults, setLookupResults] = useState<Lookup[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    publicGet<RestaurantInfo>(`/public/restaurants/${slug}`)
      .then(setRestaurant)
      .catch((e: Error) => setLoadError(e.message));
    const today = new Date();
    today.setDate(today.getDate() + 1);
    setForm(f => ({ ...f, date: today.toISOString().slice(0, 10) }));
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.guestName.trim() || !form.guestPhone.trim() || !form.date || !form.time) {
      setError("Please fill in all required fields");
      return;
    }
    if (form.partySize < 1) { setError("Party size must be at least 1"); return; }
    setSubmitting(true);
    try {
      const result = await publicPost<ReservationConfirmation>(`/public/restaurants/${slug}/reservations`, {
        guestName: form.guestName.trim(),
        guestPhone: form.guestPhone.trim(),
        guestEmail: form.guestEmail.trim() || undefined,
        partySize: form.partySize,
        scheduledAt: `${form.date}T${form.time}`,
        notes: form.notes.trim() || undefined,
      });
      setConfirmation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setLookupResults(null);
    if (!lookupPhone.trim()) { setLookupError("Please enter your phone number"); return; }
    setLookingUp(true);
    try {
      const qs = new URLSearchParams({ phone: lookupPhone.trim() });
      if (lookupDate) qs.set("date", lookupDate);
      const results = await publicGet<Lookup[]>(`/public/restaurants/${slug}/reservations/lookup?${qs.toString()}`);
      setLookupResults(results);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-3" />
          <p className="font-semibold">Restaurant not found</p>
          <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }

  if (confirmation) {
    return (
      <div className="min-h-screen bg-muted/30 px-4 py-8 flex items-start justify-center">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-sm p-6">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold">Reservation request sent!</h1>
            <p className="text-sm text-muted-foreground mt-1">{restaurant.name} will confirm your booking shortly.</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Guest</span><span className="font-medium">{confirmation.guestName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Party</span><span className="font-medium">{confirmation.partySize} guests</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">When</span><span className="font-medium">{formatTime(confirmation.scheduledAt)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
              <span className={cn("font-medium px-2 py-0.5 rounded-full text-xs", STATUS_LABEL[confirmation.status]?.bg, STATUS_LABEL[confirmation.status]?.text)}>
                {STATUS_LABEL[confirmation.status]?.label ?? confirmation.status}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Reference #{confirmation.id}. You can check status anytime using your phone number.
          </p>
          <button onClick={() => { setConfirmation(null); setForm(f => ({ ...f, guestName: "", notes: "" })); }}
            className="w-full mt-6 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Make another booking
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="text-center mb-6">
          {restaurant.logoUrl ? (
            <img src={restaurant.logoUrl} alt={restaurant.name} className="w-16 h-16 mx-auto rounded-xl object-cover mb-3" />
          ) : (
            <div className="w-16 h-16 mx-auto rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-3 font-bold text-2xl">
              {restaurant.name[0]}
            </div>
          )}
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">Book a table</p>
        </div>

        <div className="flex rounded-xl border border-border overflow-hidden mb-4 bg-card">
          <button onClick={() => setTab("book")}
            className={cn("flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5", tab === "book" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
            <CalendarDays className="w-4 h-4" /> Book
          </button>
          <button onClick={() => setTab("lookup")}
            className={cn("flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 border-l border-border", tab === "lookup" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
            <Search className="w-4 h-4" /> Check status
          </button>
        </div>

        {tab === "book" ? (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
            <div>
              <label className="text-sm font-medium mb-1 block">Your name *</label>
              <input className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" required
                value={form.guestName} onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1"><Phone className="w-3.5 h-3.5" />Phone *</label>
              <input className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" required type="tel"
                value={form.guestPhone} onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))} placeholder="+91 ..." />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1"><Mail className="w-3.5 h-3.5" />Email</label>
              <input className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" type="email"
                value={form.guestEmail} onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))} placeholder="optional" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block flex items-center gap-1"><Users className="w-3.5 h-3.5" />Guests</label>
                <input type="number" min="1" max="50" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" required
                  value={form.partySize} onChange={e => setForm(f => ({ ...f, partySize: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Date</label>
                <input type="date" className="w-full h-10 px-2 rounded-md border border-input bg-background text-sm" required
                  value={form.date} min={new Date().toISOString().slice(0, 10)} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Time</label>
                <input type="time" className="w-full h-10 px-2 rounded-md border border-input bg-background text-sm" required
                  value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />Notes</label>
              <textarea rows={2} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Allergies, occasion, seating preferences…" />
            </div>
            {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-95 disabled:opacity-60">
              {submitting ? "Sending request…" : "Request reservation"}
            </button>
            <p className="text-xs text-muted-foreground text-center">Your request goes to the restaurant for confirmation.</p>
          </form>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <form onSubmit={handleLookup} className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Phone number *</label>
                <input className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" required type="tel"
                  value={lookupPhone} onChange={e => setLookupPhone(e.target.value)} placeholder="The number you booked with" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Reservation date *</label>
                <input type="date" required className="w-full h-10 px-2 rounded-md border border-input bg-background text-sm"
                  value={lookupDate} onChange={e => setLookupDate(e.target.value)} />
              </div>
              {lookupError && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{lookupError}</p>}
              <button type="submit" disabled={lookingUp} className="w-full h-10 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-95 disabled:opacity-60">
                {lookingUp ? "Looking up…" : "Find my reservation"}
              </button>
            </form>

            {lookupResults && (
              <div className="mt-5 space-y-2">
                {lookupResults.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No reservations found for this phone number.</p>
                )}
                {lookupResults.map(r => {
                  const cfg = STATUS_LABEL[r.status] ?? { label: r.status, bg: "bg-muted", text: "text-foreground" };
                  return (
                    <div key={r.id} className="border border-border rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="font-semibold">{r.guestName}</p>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cfg.bg, cfg.text)}>{cfg.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatTime(r.scheduledAt)} · {r.partySize} guests</p>
                      {r.notes && <p className="text-xs italic text-muted-foreground mt-1">"{r.notes}"</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
