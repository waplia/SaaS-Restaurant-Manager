import { useParams, Redirect } from "wouter";
import WhatsAppSection from "./settings-whatsapp";
import WebPushSection from "./settings-web-push";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { SettingsLayout, SETTINGS_GROUPS, type SectionKey } from "@/components/settings/SettingsLayout";
import { SettingForm, Field, Row, Toggle, Select, ListEditor } from "@/components/settings/SettingForm";
import { useRestaurantInfo, useSubscription, useRestaurantId, useUpdateRestaurant, useRestaurantEmailSettings, useUpdateRestaurantEmailSettings, type RestaurantEmailSettings } from "@/lib/hooks";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trash2, ExternalLink, Lock, FileDown } from "lucide-react";
import { Link } from "wouter";
import { ImageUploadField } from "@/components/ImageUploadField";
import { usePlanCapability } from "@/lib/planFeatures";
import { ArrowRight } from "lucide-react";

// Settings sections whose UI is itself a paid feature. When the tenant's plan
// doesn't include the matching feature flag we render a locked card pointing
// at /pricing instead of the section UI, so direct URL access can't bypass.
const SECTION_PLAN_FEATURE: Partial<Record<SectionKey, string>> = {
  loyalty: "loyalty_program",
  discounts: "discounts_promotions",
  reservation: "reservations",
  "direct-ordering": "online_ordering",
};

const OWNER_ONLY_KEYS = new Set<SectionKey>([
  "general", "email", "payment", "billing", "roles", "ai", "theme",
  "currencies", "taxes", "loyalty", "discounts", "whatsapp", "web-push",
]);

const ALLOWED_KEYS = new Set<SectionKey>([
  "general", "app", "shifts", "open-close", "branch", "currencies",
  "email", "taxes", "payment", "theme", "roles", "billing",
  "reservation", "about-us", "customer-site", "receipt", "printer",
  "downloads", "menu-image", "delivery", "allergens", "kot",
  "cancellation-reasons", "order-settings", "refund-reasons",
  "ai", "kiosk", "loyalty", "discounts", "whatsapp", "web-push",
  "direct-ordering",
]);

function findMeta(key: SectionKey) {
  for (const g of SETTINGS_GROUPS) {
    const m = g.items.find(i => i.key === key);
    if (m) return m;
  }
  return null;
}

export default function SettingsSectionPage() {
  const params = useParams<{ section?: string }>();
  const { user } = useAuth();
  const sectionParam = (params.section ?? "general") as SectionKey;

  if (!ALLOWED_KEYS.has(sectionParam)) {
    return <Redirect to="/settings/general" />;
  }

  const isOwner = !!user?.isSuperAdmin || user?.role === "owner";
  if (OWNER_ONLY_KEYS.has(sectionParam) && !isOwner) {
    return <Redirect to="/settings/app" />;
  }

  const meta = findMeta(sectionParam);
  const planFeatureKey = SECTION_PLAN_FEATURE[sectionParam];

  return (
    <SettingsLayout activeKey={sectionParam} title={meta?.label ?? "Settings"}>
      {planFeatureKey ? (
        <PlanGatedSection featureKey={planFeatureKey} sectionLabel={meta?.label ?? sectionParam}>
          {renderSection(sectionParam)}
        </PlanGatedSection>
      ) : (
        renderSection(sectionParam)
      )}
    </SettingsLayout>
  );
}

function PlanGatedSection({ featureKey, sectionLabel, children }: { featureKey: string; sectionLabel: string; children: React.ReactNode }) {
  const cap = usePlanCapability(featureKey);
  if (cap.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (cap.enabled) return <>{children}</>;
  return (
    <div className="p-6">
      <div className="max-w-md mx-auto bg-card border border-border rounded-2xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">{sectionLabel}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {cap.planName
            ? `${sectionLabel} is not included on your ${cap.planName} plan.`
            : `${sectionLabel} requires a paid plan.`}{" "}
          Upgrade to unlock this section.
        </p>
        <Link href={`/pricing?feature=${encodeURIComponent(featureKey)}`}>
          <Button className="gap-2">See plans <ArrowRight className="w-4 h-4" /></Button>
        </Link>
      </div>
    </div>
  );
}

function renderSection(key: SectionKey) {
  switch (key) {
    case "general": return <GeneralSection />;
    case "app": return <AppSection />;
    case "shifts": return <ShiftsSection />;
    case "open-close": return <OpenCloseSection />;
    case "branch": return <BranchSection />;
    case "currencies": return <CurrenciesSection />;
    case "email": return <EmailSection />;
    case "taxes": return <TaxesSection />;
    case "payment": return <PaymentSection />;
    case "theme": return <ThemeSection />;
    case "roles": return <RolesSection />;
    case "billing": return <BillingSection />;
    case "reservation": return <ReservationSection />;
    case "about-us": return <AboutSection />;
    case "customer-site": return <CustomerSiteSection />;
    case "receipt": return <ReceiptSection />;
    case "printer": return <PrinterSection />;
    case "downloads": return <DownloadsSection />;
    case "menu-image": return <MenuImageSection />;
    case "delivery": return <DeliverySection />;
    case "allergens": return <AllergensSection />;
    case "kot": return <KotSection />;
    case "cancellation-reasons": return <CancellationReasonsSection />;
    case "order-settings": return <OrderSettingsSection />;
    case "refund-reasons": return <RefundReasonsSection />;
    case "direct-ordering": return <DirectOrderingSection />;
    case "ai": return <AiSection />;
    case "kiosk": return <KioskSection />;
    case "loyalty": return <LoyaltySection />;
    case "discounts": return <DiscountsSection />;
    case "whatsapp": return <WhatsAppSection />;
    case "web-push": return <WebPushSection />;
    default: return null;
  }
}

/* ---------------- 1. General ---------------- */
interface GeneralCfg {
  legalName: string; registrationNumber: string; gstin: string;
  contactEmail: string; contactPhone: string;
  addressLine1: string; addressLine2: string; city: string; state: string;
  country: string; postalCode: string; timezone: string; locale: string; defaultLanguage: string;
}
function GeneralSection() {
  const { data: r } = useRestaurantInfo();
  const defaults: GeneralCfg = {
    legalName: r?.name ?? "", registrationNumber: "", gstin: "",
    contactEmail: r?.email ?? "", contactPhone: r?.phone ?? "",
    addressLine1: r?.address ?? "", addressLine2: "", city: r?.city ?? "",
    state: "", country: "IN", postalCode: "",
    timezone: "Asia/Kolkata", locale: "en-IN", defaultLanguage: "en",
  };
  return (
    <SettingForm section="general" defaults={defaults}
      description="Legal identity, contact, and locale used on receipts, invoices, and tax filings.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Legal name" required><Input value={s.legalName} onChange={e => set(p => ({ ...p, legalName: e.target.value }))} /></Field>
            <Field label="Registration #"><Input value={s.registrationNumber} onChange={e => set(p => ({ ...p, registrationNumber: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="GSTIN / VAT"><Input value={s.gstin} onChange={e => set(p => ({ ...p, gstin: e.target.value }))} /></Field>
            <Field label="Contact email"><Input type="email" value={s.contactEmail} onChange={e => set(p => ({ ...p, contactEmail: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Contact phone"><PhoneInput value={s.contactPhone} onChange={(v) => set(p => ({ ...p, contactPhone: v }))} /></Field>
            <Field label="Postal code"><Input value={s.postalCode} onChange={e => set(p => ({ ...p, postalCode: e.target.value }))} /></Field>
          </Row>
          <Field label="Address line 1"><Input value={s.addressLine1} onChange={e => set(p => ({ ...p, addressLine1: e.target.value }))} /></Field>
          <Field label="Address line 2"><Input value={s.addressLine2} onChange={e => set(p => ({ ...p, addressLine2: e.target.value }))} /></Field>
          <Row>
            <Field label="City"><Input value={s.city} onChange={e => set(p => ({ ...p, city: e.target.value }))} /></Field>
            <Field label="State"><Input value={s.state} onChange={e => set(p => ({ ...p, state: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Country"><Input value={s.country} onChange={e => set(p => ({ ...p, country: e.target.value }))} /></Field>
            <Field label="Timezone"><Input value={s.timezone} onChange={e => set(p => ({ ...p, timezone: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Locale" hint="e.g. en-IN, en-US, fr-FR"><Input value={s.locale} onChange={e => set(p => ({ ...p, locale: e.target.value }))} /></Field>
            <Field label="Default language">
              <Select value={s.defaultLanguage} onChange={v => set(p => ({ ...p, defaultLanguage: v }))} options={[
                { value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "es", label: "Spanish" },
                { value: "fr", label: "French" }, { value: "de", label: "German" }, { value: "ar", label: "Arabic" },
              ]} />
            </Field>
          </Row>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 2. App ---------------- */
interface AppCfg {
  dateFormat: string; timeFormat: "12h" | "24h"; numberFormat: string;
  weekStart: "monday" | "sunday";
  defaultLandingOwner: string; defaultLandingManager: string; defaultLandingWaiter: string;
  lowStockThresholdPct: number; sidebarDensity: "compact" | "comfortable";
}
function AppSection() {
  const defaults: AppCfg = {
    dateFormat: "DD/MM/YYYY", timeFormat: "24h", numberFormat: "1,234.56",
    weekStart: "monday",
    defaultLandingOwner: "/dashboard", defaultLandingManager: "/orders", defaultLandingWaiter: "/pos",
    lowStockThresholdPct: 20, sidebarDensity: "comfortable",
  };
  return (
    <SettingForm section="app" defaults={defaults}
      description="Display preferences, default landing pages per role, and inventory alert sensitivity.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Date format">
              <Select value={s.dateFormat} onChange={v => set(p => ({ ...p, dateFormat: v }))} options={[
                { value: "DD/MM/YYYY", label: "DD/MM/YYYY" }, { value: "MM/DD/YYYY", label: "MM/DD/YYYY" }, { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
              ]} />
            </Field>
            <Field label="Time format">
              <Select value={s.timeFormat} onChange={v => set(p => ({ ...p, timeFormat: v as AppCfg["timeFormat"] }))} options={[
                { value: "24h", label: "24-hour (14:30)" }, { value: "12h", label: "12-hour (2:30 PM)" },
              ]} />
            </Field>
          </Row>
          <Row>
            <Field label="Number format">
              <Select value={s.numberFormat} onChange={v => set(p => ({ ...p, numberFormat: v }))} options={[
                { value: "1,234.56", label: "1,234.56" }, { value: "1.234,56", label: "1.234,56" }, { value: "1234.56", label: "1234.56" },
              ]} />
            </Field>
            <Field label="Week starts on">
              <Select value={s.weekStart} onChange={v => set(p => ({ ...p, weekStart: v as AppCfg["weekStart"] }))} options={[
                { value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" },
              ]} />
            </Field>
          </Row>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Default landing page per role</p>
          <Row>
            <Field label="Owner"><Input value={s.defaultLandingOwner} onChange={e => set(p => ({ ...p, defaultLandingOwner: e.target.value }))} /></Field>
            <Field label="Manager"><Input value={s.defaultLandingManager} onChange={e => set(p => ({ ...p, defaultLandingManager: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Waiter"><Input value={s.defaultLandingWaiter} onChange={e => set(p => ({ ...p, defaultLandingWaiter: e.target.value }))} /></Field>
            <Field label="Low-stock threshold (%)" hint="Alert when an item is below this % of its min level.">
              <Input type="number" value={s.lowStockThresholdPct} onChange={e => set(p => ({ ...p, lowStockThresholdPct: Number(e.target.value) }))} />
            </Field>
          </Row>
          <Field label="Sidebar density">
            <Select value={s.sidebarDensity} onChange={v => set(p => ({ ...p, sidebarDensity: v as AppCfg["sidebarDensity"] }))} options={[
              { value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" },
            ]} />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 3. Operational Shifts ---------------- */
interface ShiftDef { id: string; name: string; startTime: string; endTime: string; days: string[]; requiredRoles: string[]; }
interface ShiftsCfg { shifts: ShiftDef[] }
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ROLE_OPTIONS = ["waiter", "kitchen", "manager", "delivery_executive"];
function ShiftsSection() {
  const defaults: ShiftsCfg = { shifts: [
    { id: "morning", name: "Morning", startTime: "08:00", endTime: "12:00", days: DAYS, requiredRoles: ["waiter", "kitchen"] },
    { id: "lunch", name: "Lunch", startTime: "12:00", endTime: "16:00", days: DAYS, requiredRoles: ["waiter", "kitchen"] },
    { id: "dinner", name: "Dinner", startTime: "18:00", endTime: "23:00", days: DAYS, requiredRoles: ["waiter", "kitchen", "manager"] },
  ]};
  return (
    <SettingForm section="shifts" defaults={defaults}
      description="Shifts drive staff schedules, kitchen routing windows, and shift-based reports.">
      {(s, set) => (
        <ListEditor
          items={s.shifts}
          onChange={items => set(p => ({ ...p, shifts: items }))}
          addLabel="Add shift"
          makeNew={() => ({ id: `shift-${Date.now()}`, name: "", startTime: "09:00", endTime: "17:00", days: [...DAYS], requiredRoles: [] })}
          render={(item, _i, update, remove) => (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Shift name" value={item.name} onChange={e => update({ name: e.target.value })} />
                <Input className="w-24" type="time" value={item.startTime} onChange={e => update({ startTime: e.target.value })} />
                <span className="text-muted-foreground text-xs">to</span>
                <Input className="w-24" type="time" value={item.endTime} onChange={e => update({ endTime: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(d => (
                  <button key={d} type="button"
                    onClick={() => update({ days: item.days.includes(d) ? item.days.filter(x => x !== d) : [...item.days, d] })}
                    className={"text-xs px-2 py-1 rounded border " + (item.days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background text-muted-foreground")}>
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Required roles</p>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map(r => (
                    <button key={r} type="button"
                      onClick={() => update({ requiredRoles: item.requiredRoles.includes(r) ? item.requiredRoles.filter(x => x !== r) : [...item.requiredRoles, r] })}
                      className={"text-xs px-2 py-1 rounded border " + (item.requiredRoles.includes(r) ? "bg-accent text-accent-foreground border-border" : "border-dashed border-border text-muted-foreground")}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        />
      )}
    </SettingForm>
  );
}

/* ---------------- 4. Open / Close ---------------- */
interface DayHours { open: boolean; from: string; to: string; breakFrom?: string; breakTo?: string; }
interface Holiday { date: string; closed: boolean; from?: string; to?: string; note?: string; }
interface OpenCloseCfg {
  hours: Record<string, DayHours>;
  holidays: Holiday[];
  override: { closed: boolean; reason: string; until: string };
}
function OpenCloseSection() {
  const defaults: OpenCloseCfg = {
    hours: Object.fromEntries(DAYS.map(d => [d, { open: true, from: "09:00", to: "22:00" } as DayHours])) as Record<string, DayHours>,
    holidays: [],
    override: { closed: false, reason: "", until: "" },
  };
  return (
    <SettingForm section="open-close" defaults={defaults}
      description="Opening hours per weekday, holiday calendar, and a one-tap close override.">
      {(s, set) => (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Weekly hours</p>
          <div className="space-y-2">
            {DAYS.map(d => {
              const h = s.hours[d] ?? { open: true, from: "09:00", to: "22:00" };
              return (
                <div key={d} className="flex items-center gap-3 border border-border rounded-lg p-2.5">
                  <span className="w-12 text-sm font-medium uppercase">{d}</span>
                  <input type="checkbox" checked={h.open} onChange={e => set(p => ({ ...p, hours: { ...p.hours, [d]: { ...h, open: e.target.checked } } }))} />
                  <Input className="w-28 h-8" type="time" value={h.from} disabled={!h.open}
                    onChange={e => set(p => ({ ...p, hours: { ...p.hours, [d]: { ...h, from: e.target.value } } }))} />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input className="w-28 h-8" type="time" value={h.to} disabled={!h.open}
                    onChange={e => set(p => ({ ...p, hours: { ...p.hours, [d]: { ...h, to: e.target.value } } }))} />
                  <span className="text-xs text-muted-foreground ml-2">break</span>
                  <Input className="w-28 h-8" type="time" value={h.breakFrom ?? ""} disabled={!h.open}
                    onChange={e => set(p => ({ ...p, hours: { ...p.hours, [d]: { ...h, breakFrom: e.target.value } } }))} />
                  <Input className="w-28 h-8" type="time" value={h.breakTo ?? ""} disabled={!h.open}
                    onChange={e => set(p => ({ ...p, hours: { ...p.hours, [d]: { ...h, breakTo: e.target.value } } }))} />
                </div>
              );
            })}
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Holiday calendar</p>
          <ListEditor
            items={s.holidays}
            onChange={items => set(p => ({ ...p, holidays: items }))}
            addLabel="Add holiday"
            makeNew={() => ({ date: new Date().toISOString().slice(0, 10), closed: true, note: "" })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input className="w-40 h-8" type="date" value={item.date} onChange={e => update({ date: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={item.closed} onChange={e => update({ closed: e.target.checked })} /> Closed</label>
                {!item.closed && (
                  <>
                    <Input className="w-24 h-8" type="time" value={item.from ?? ""} onChange={e => update({ from: e.target.value })} />
                    <Input className="w-24 h-8" type="time" value={item.to ?? ""} onChange={e => update({ to: e.target.value })} />
                  </>
                )}
                <Input className="flex-1 h-8" placeholder="Note (e.g. Diwali)" value={item.note ?? ""} onChange={e => update({ note: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Override</p>
          <Toggle label="Close now (override)" hint="Forces the restaurant to be marked closed until reopened or the time below."
            checked={s.override.closed} onChange={v => set(p => ({ ...p, override: { ...p.override, closed: v } }))} />
          {s.override.closed && (
            <Row>
              <Field label="Reason"><Input value={s.override.reason} onChange={e => set(p => ({ ...p, override: { ...p.override, reason: e.target.value } }))} /></Field>
              <Field label="Auto-reopen at"><Input type="datetime-local" value={s.override.until} onChange={e => set(p => ({ ...p, override: { ...p.override, until: e.target.value } }))} /></Field>
            </Row>
          )}
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 5. Branch ---------------- */
function BranchSection() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Branches are managed as first-class entities. Add, edit, and switch the default branch in the Branches CRUD.
      </p>
      <div className="border border-border rounded-xl p-6 bg-card">
        <p className="font-medium text-foreground mb-2">Branch management</p>
        <p className="text-sm text-muted-foreground mb-4">Multi-outlet support — each branch has its own address, manager, and active flag.</p>
        <BranchListInline />
      </div>
    </div>
  );
}

/* Inline branch CRUD using existing /restaurants/:id/branches endpoints */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef, useMemo } from "react";

interface BranchRow { id: number; name: string; address: string | null; phone: string | null; isMain: boolean; isActive: boolean; }

function BranchListInline() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches", RESTAURANT_ID],
    queryFn: () => apiGet<BranchRow[]>(`/restaurants/${RESTAURANT_ID}/branches`),
  });
  const create = useMutation({
    mutationFn: (b: { name: string; address?: string; phone?: string; isMain?: boolean }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/branches`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branches", RESTAURANT_ID] }); toast({ title: "Branch added" }); },
  });
  const [form, setForm] = useState({ name: "", address: "", phone: "", isMain: false });

  return (
    <div className="space-y-3">
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : branches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No branches yet — add your first below.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Address</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Status</th></tr>
            </thead>
            <tbody>
              {branches.map(b => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{b.name} {b.isMain && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-1">MAIN</span>}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.address ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.phone ?? "—"}</td>
                  <td className="px-3 py-2">{b.isActive ? <span className="text-xs text-green-600">Active</span> : <span className="text-xs text-muted-foreground">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-border">
        <Input placeholder="Branch name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        <Input placeholder="Address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
        <PhoneInput value={form.phone} onChange={(v) => setForm(p => ({ ...p, phone: v }))} />
        <Button onClick={async () => {
          if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
          await create.mutateAsync({ name: form.name.trim(), address: form.address || undefined, phone: form.phone || undefined, isMain: form.isMain });
          setForm({ name: "", address: "", phone: "", isMain: false });
        }} disabled={create.isPending}>Add branch</Button>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isMain} onChange={e => setForm(p => ({ ...p, isMain: e.target.checked }))} /> Mark as main branch</label>
    </div>
  );
}

/* ---------------- 6. Currencies ---------------- */
interface CurrenciesCfg {
  primary: string; symbol: string; symbolPosition: "before" | "after"; decimalPlaces: number;
  thousandsSeparator: string; decimalSeparator: string;
  secondaryEnabled: boolean; secondary: string; secondarySymbol: string; manualFxRate: number;
}
function CurrenciesSection() {
  const defaults: CurrenciesCfg = {
    primary: "INR", symbol: "₹", symbolPosition: "before", decimalPlaces: 2,
    thousandsSeparator: ",", decimalSeparator: ".",
    secondaryEnabled: false, secondary: "USD", secondarySymbol: "$", manualFxRate: 0.012,
  };
  return (
    <SettingForm section="currencies" defaults={defaults}
      description="Currency rendering across POS, receipts, and customer menu. Live FX is not enabled — use the manual rate field.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Primary currency"><Input value={s.primary} onChange={e => set(p => ({ ...p, primary: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Symbol"><Input value={s.symbol} onChange={e => set(p => ({ ...p, symbol: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Symbol position">
              <Select value={s.symbolPosition} onChange={v => set(p => ({ ...p, symbolPosition: v as CurrenciesCfg["symbolPosition"] }))} options={[
                { value: "before", label: "Before amount (₹100)" }, { value: "after", label: "After amount (100₹)" },
              ]} />
            </Field>
            <Field label="Decimal places"><Input type="number" min={0} max={4} value={s.decimalPlaces} onChange={e => set(p => ({ ...p, decimalPlaces: Number(e.target.value) }))} /></Field>
          </Row>
          <Row>
            <Field label="Thousands separator"><Input value={s.thousandsSeparator} onChange={e => set(p => ({ ...p, thousandsSeparator: e.target.value }))} /></Field>
            <Field label="Decimal separator"><Input value={s.decimalSeparator} onChange={e => set(p => ({ ...p, decimalSeparator: e.target.value }))} /></Field>
          </Row>
          <Toggle label="Show secondary currency on receipts" checked={s.secondaryEnabled} onChange={v => set(p => ({ ...p, secondaryEnabled: v }))} />
          {s.secondaryEnabled && (
            <Row>
              <Field label="Secondary currency"><Input value={s.secondary} onChange={e => set(p => ({ ...p, secondary: e.target.value.toUpperCase() }))} /></Field>
              <Field label="Manual FX rate" hint="1 primary = X secondary"><Input type="number" step="0.0001" value={s.manualFxRate} onChange={e => set(p => ({ ...p, manualFxRate: Number(e.target.value) }))} /></Field>
            </Row>
          )}
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 7. Email ---------------- */
interface EmailCfg {
  senderName: string; replyTo: string;
  templates: {
    orderConfirmation: { subject: string; body: string };
    receipt: { subject: string; body: string };
    staffInvite: { subject: string; body: string };
    reservationConfirmation: { subject: string; body: string };
  };
}
function EmailSection() {
  return (
    <div className="space-y-6">
      <RestaurantEmailCommunicationCard />
      <EmailSectionLegacy />
    </div>
  );
}

function RestaurantEmailCommunicationCard() {
  const { data, isLoading } = useRestaurantEmailSettings();
  const update = useUpdateRestaurantEmailSettings();
  const { toast } = useToast();
  if (isLoading || !data) {
    return <div className="border border-border rounded-lg p-4 text-sm text-muted-foreground">Loading email communication settings…</div>;
  }
  const Toggle = ({ k, label, hint }: { k: keyof RestaurantEmailSettings; label: string; hint?: string }) => (
    <label className="flex items-start justify-between gap-3 py-2 cursor-pointer">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={Boolean(data[k])} onCheckedChange={(v) => update.mutate({ [k]: v } as Partial<RestaurantEmailSettings>, { onSuccess: () => toast({ title: "Saved" }) })} />
    </label>
  );
  return (
    <div className="border border-border rounded-xl p-5 space-y-3 bg-card">
      <div>
        <p className="text-sm font-semibold">Communication → Email</p>
        <p className="text-xs text-muted-foreground mt-0.5">Marketing &amp; follow-up email controls for this restaurant. Plan limits apply.</p>
      </div>
      <Toggle k="marketingEnabled" label="Marketing emails" hint="Send opt-in marketing campaigns to your customers." />
      <Toggle k="followUpEnabled" label="Follow-up automations" hint="Birthday wishes, win-back, feedback requests and reviews." />
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
        <Toggle k="birthdayEnabled" label="Birthday emails" />
        <Toggle k="feedbackEnabled" label="Feedback requests" />
        <Toggle k="reviewEnabled" label="Review requests" />
        <Toggle k="inactiveEnabled" label="Win-back emails" />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
        <div className="space-y-1">
          <Label className="text-xs">From name</Label>
          <Input value={data.fromName} onChange={e => update.mutate({ fromName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reply-to address</Label>
          <Input value={data.replyTo ?? ""} onChange={e => update.mutate({ replyTo: e.target.value })} />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Footer text (required for marketing)</Label>
          <Input value={data.footerText} onChange={e => update.mutate({ footerText: e.target.value })} />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Business address (required for marketing)</Label>
          <Input value={data.businessAddress} onChange={e => update.mutate({ businessAddress: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function EmailSectionLegacy() {
  const defaults: EmailCfg = {
    senderName: "KhanaLagao", replyTo: "",
    templates: {
      orderConfirmation: { subject: "Your order #{order_number} is confirmed", body: "Hi {customer_name},\n\nThanks for ordering with us! Your order #{order_number} totalling {total} is confirmed and will be ready shortly.\n\n— {restaurant_name}" },
      receipt: { subject: "Receipt for order #{order_number}", body: "Thanks for dining with us. Your receipt is attached.\n\nTotal: {total}\nPayment: {payment_method}" },
      staffInvite: { subject: "You've been invited to {restaurant_name}", body: "Hi {staff_name},\n\nYou've been invited to join {restaurant_name} on KhanaLagao. Click the link to set your password: {invite_link}" },
      reservationConfirmation: { subject: "Reservation confirmed for {date} at {time}", body: "Hi {customer_name},\n\nYour reservation for {party_size} at {date} {time} is confirmed.\n\nSee you soon — {restaurant_name}" },
    },
  };
  const tmplLabels: { key: keyof EmailCfg["templates"]; label: string }[] = [
    { key: "orderConfirmation", label: "Order confirmation" },
    { key: "receipt", label: "Receipt" },
    { key: "staffInvite", label: "Staff invite" },
    { key: "reservationConfirmation", label: "Reservation confirmation" },
  ];
  return (
    <SettingForm section="email" defaults={defaults}
      description="Sender identity and templates for transactional email. SMTP credentials are managed in the platform Secrets pane.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Sender name" hint="What recipients see in the From field"><Input value={s.senderName} onChange={e => set(p => ({ ...p, senderName: e.target.value }))} /></Field>
            <Field label="Reply-to address"><Input type="email" value={s.replyTo} onChange={e => set(p => ({ ...p, replyTo: e.target.value }))} /></Field>
          </Row>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-200">SMTP credentials</p>
              <p className="text-amber-800 dark:text-amber-300/80 text-xs mt-0.5">
                For security, SMTP_HOST / SMTP_USER / SMTP_PASS are stored as platform secrets — not in this form.
                Ask the workspace owner to set them via Replit Secrets.
              </p>
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Templates</p>
          <p className="text-xs text-muted-foreground -mt-3">Use placeholders like {"{customer_name}"}, {"{order_number}"}, {"{total}"}, {"{restaurant_name}"}.</p>
          {tmplLabels.map(({ key, label }) => {
            const t = s.templates[key];
            return (
              <div key={key} className="border border-border rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">{label}</p>
                <Input placeholder="Subject" value={t.subject} onChange={e => set(p => ({ ...p, templates: { ...p.templates, [key]: { ...t, subject: e.target.value } } }))} />
                <Textarea rows={5} value={t.body} onChange={e => set(p => ({ ...p, templates: { ...p.templates, [key]: { ...t, body: e.target.value } } }))} />
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Preview</summary>
                  <div className="mt-2 p-3 bg-muted/30 rounded text-foreground whitespace-pre-wrap font-mono text-[11px]">
                    <p className="font-semibold mb-1">Subject: {t.subject}</p>
                    {t.body}
                  </div>
                </details>
              </div>
            );
          })}
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 8. Taxes ---------------- */
interface TaxRow { id: string; name: string; rate: number; type: "inclusive" | "exclusive"; appliesTo: string[]; isDefault: boolean; }
interface TaxesCfg { rates: TaxRow[]; compoundTax: boolean; exemptionRules: string; }
function TaxesSection() {
  const defaults: TaxesCfg = {
    rates: [
      { id: "gst-5", name: "GST 5%", rate: 5, type: "exclusive" as const, appliesTo: ["dine-in", "takeaway", "delivery"], isDefault: true },
    ],
    compoundTax: false,
    exemptionRules: "",
  };
  return (
    <SettingForm section="taxes" defaults={defaults}
      description="Tax rates applied at checkout. Set one as default for new menu items.">
      {(s, set) => (
        <>
          <ListEditor
            items={s.rates}
            onChange={items => set(p => ({ ...p, rates: items }))}
            addLabel="Add tax rate"
            makeNew={(): TaxRow => ({ id: `tax-${Date.now()}`, name: "", rate: 5, type: "exclusive", appliesTo: ["dine-in"], isDefault: false })}
            render={(item, _i, update, remove) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="e.g. GST 5%" value={item.name} onChange={e => update({ name: e.target.value })} />
                  <Input className="w-24" type="number" step="0.01" placeholder="%" value={item.rate} onChange={e => update({ rate: Number(e.target.value) })} />
                  <select className="border border-input rounded-md px-2 py-2 text-sm bg-background" value={item.type}
                    onChange={e => update({ type: e.target.value as TaxRow["type"] })}>
                    <option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option>
                  </select>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Applies to:</span>
                  {["dine-in", "takeaway", "delivery"].map(c => (
                    <label key={c} className="flex items-center gap-1">
                      <input type="checkbox" checked={item.appliesTo.includes(c)}
                        onChange={e => update({ appliesTo: e.target.checked ? [...item.appliesTo, c] : item.appliesTo.filter(x => x !== c) })} />
                      {c}
                    </label>
                  ))}
                  <label className="flex items-center gap-1 ml-auto">
                    <input type="checkbox" checked={item.isDefault} onChange={e => update({ isDefault: e.target.checked })} /> Default
                  </label>
                </div>
              </div>
            )}
          />
          <Toggle label="Compound tax" hint="Apply later taxes on top of earlier-tax-inclusive amounts."
            checked={s.compoundTax} onChange={v => set(p => ({ ...p, compoundTax: v }))} />
          <Field label="Tax-exemption rules" hint="Free-text rules e.g. exempt categories or customer types.">
            <Textarea rows={3} value={s.exemptionRules} onChange={e => set(p => ({ ...p, exemptionRules: e.target.value }))} />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 9. Payment ----------------
 * Task #587 — Restructured into two explicit groups:
 *   • Offline (counter) — Pay at Counter, Cash, Card on counter, UPI on counter,
 *     COD, Bank Transfer, Pay Later. Only ever shown to staff in the POS flow.
 *   • Online — Platform gateways, Restaurant Own Payment Method (own gateway
 *     keys), and Manual UPI. This is the ONLY pool the customer sees at
 *     QR / online checkout.
 * POS flow is unchanged — it continues to read `restaurants.acceptedPaymentMethods`. */
interface PaymentMethodRow { id: number; category: "offline" | "online"; type: string; label: string | null; isEnabled: boolean; gatewayCode: string | null; sortOrder: number; config: Record<string, unknown>; }

/** Per-gateway credential field catalog. Kept in sync with the
 *  GATEWAY_CREDENTIAL_FIELDS map on the API; the secret-flagged fields
 *  are encrypted server-side before being persisted, and only the masked
 *  preview ("rzp…wxyz") is returned to this form on subsequent loads. */
interface GatewayField { name: string; label: string; secret: boolean; placeholder?: string }
const GATEWAY_FIELDS: Record<string, GatewayField[]> = {
  razorpay: [
    { name: "key_id", label: "Key ID", secret: false, placeholder: "rzp_live_xxxxxxxx" },
    { name: "key_secret", label: "Key Secret", secret: true },
    { name: "webhook_secret", label: "Webhook Secret (optional)", secret: true },
  ],
  cashfree: [
    { name: "app_id", label: "App ID", secret: false },
    { name: "secret_key", label: "Secret Key", secret: true },
    { name: "webhook_secret", label: "Webhook Secret (optional)", secret: true },
  ],
  stripe: [
    { name: "publishable_key", label: "Publishable Key", secret: false, placeholder: "pk_live_xxxxxxxx" },
    { name: "secret_key", label: "Secret Key", secret: true, placeholder: "sk_live_xxxxxxxx" },
    { name: "webhook_secret", label: "Webhook Signing Secret (optional)", secret: true },
  ],
  phonepe: [
    { name: "merchant_id", label: "Merchant ID", secret: false },
    { name: "salt_key", label: "Salt Key", secret: true },
    { name: "salt_index", label: "Salt Index", secret: false, placeholder: "1" },
  ],
  payu: [
    { name: "merchant_key", label: "Merchant Key", secret: false },
    { name: "merchant_salt", label: "Merchant Salt", secret: true },
  ],
  paytm: [
    { name: "mid", label: "Merchant ID (MID)", secret: false },
    { name: "merchant_key", label: "Merchant Key", secret: true },
  ],
  ccavenue: [
    { name: "merchant_id", label: "Merchant ID", secret: false },
    { name: "access_code", label: "Access Code", secret: false },
    { name: "working_key", label: "Working Key", secret: true },
  ],
  billdesk: [
    { name: "merchant_id", label: "Merchant ID", secret: false },
    { name: "security_id", label: "Security ID", secret: false },
    { name: "checksum_key", label: "Checksum Key", secret: true },
  ],
  instamojo: [
    { name: "api_key", label: "API Key", secret: false },
    { name: "auth_token", label: "Auth Token", secret: true },
  ],
  easebuzz: [
    { name: "key", label: "Key", secret: false },
    { name: "salt", label: "Salt", secret: true },
  ],
  pinelabs: [
    { name: "merchant_id", label: "Merchant ID", secret: false },
    { name: "store_id", label: "Store ID", secret: false },
    { name: "api_key", label: "API Key", secret: true },
  ],
  juspay: [
    { name: "merchant_id", label: "Merchant ID", secret: false },
    { name: "api_key", label: "API Key", secret: true },
  ],
};
interface PaymentConfigDTO {
  settings: { restaurantId: number; offlineEnabled: boolean; onlineEnabled: boolean; onlinePaymentSource: "platform_gateway" | "own_gateway" | "manual_upi" | "mixed"; defaultCustomerChoice: "pay_at_counter" | "pay_online" };
  offlineMethods: PaymentMethodRow[];
  onlineMethods: PaymentMethodRow[];
  manualUpi: null | { restaurantId: number; upiId: string | null; merchantName: string | null; enableDynamicQr: boolean; enableStaticQr: boolean; staticQrUrl: string | null; enableIntentLink: boolean; enableCopyUpiId: boolean; requireUtr: boolean; allowScreenshotUpload: boolean; autoConfirmUnderAmount: number | null; notes: string | null };
}

const OFFLINE_CATALOG: Array<{ type: string; label: string; hint: string }> = [
  { type: "pay_at_counter", label: "Pay at Counter", hint: "Generic option diners pick when they want to pay at the counter on serve. Always available." },
  { type: "cash", label: "Cash", hint: "Counter tender for physical cash." },
  { type: "counter_card", label: "Card at counter", hint: "Card swipe / dip on a POS terminal." },
  { type: "counter_upi", label: "UPI at counter", hint: "Static QR or scan-to-pay UPI at the counter." },
  { type: "cod", label: "Cash on Delivery", hint: "Pay the rider on delivery." },
  { type: "bank_transfer", label: "Bank transfer", hint: "Customer transfers offline; settle in person." },
  { type: "pay_later", label: "Pay later / Tab", hint: "Open tab — settled at end of visit." },
];

function PaymentSection() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PaymentConfigDTO>({
    queryKey: ["payment-config", RESTAURANT_ID],
    queryFn: () => apiGet(`/restaurants/${RESTAURANT_ID}/payment-config`),
  });
  const updateSettings = useMutation({
    mutationFn: (patch: Partial<PaymentConfigDTO["settings"]>) => apiPut(`/restaurants/${RESTAURANT_ID}/payment-config/settings`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-config", RESTAURANT_ID] }),
  });
  const upsertMethod = useMutation({
    mutationFn: (body: { category: "offline" | "online"; type: string; isEnabled: boolean; gatewayCode?: string | null; label?: string | null; config?: Record<string, unknown> }) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/payment-config/methods`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-config", RESTAURANT_ID] }),
  });
  const upsertManualUpi = useMutation({
    mutationFn: (body: Partial<NonNullable<PaymentConfigDTO["manualUpi"]>>) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/payment-config/manual-upi`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-config", RESTAURANT_ID] }),
  });

  if (isLoading || !data) return <div className="text-sm text-muted-foreground p-4">Loading payment settings…</div>;

  const settings = data.settings;
  const offlineByType = new Map(data.offlineMethods.map(m => [m.type, m] as const));
  // Online rows keyed by `type:gateway` so own_gateway (razorpay) ≠ own_gateway (cashfree).
  const onlineKey = (type: string, gateway: string | null) => `${type}:${gateway ?? ""}`;
  const onlineByKey = new Map(data.onlineMethods.map(m => [onlineKey(m.type, m.gatewayCode), m] as const));
  const manualUpi = data.manualUpi;
  const ownGateways = [
    "razorpay", "cashfree", "stripe", "phonepe", "payu", "paytm",
    "ccavenue", "billdesk", "instamojo", "easebuzz", "pinelabs", "juspay",
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Choose what the customer sees at QR / online checkout (always collapsed to
        <strong> Pay at Counter</strong> and <strong>Pay Online</strong>) and what
        the POS counter accepts. Counter-only methods never leak to the diner.
      </p>

      {/* ─── OFFLINE ─── */}
      <div className="border border-border rounded-xl bg-white">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">Offline (Counter)</p>
            <p className="text-xs text-muted-foreground">Tendered face-to-face by staff. Hidden from the customer-facing checkout.</p>
          </div>
          <Toggle
            label="Enabled"
            checked={settings.offlineEnabled}
            onChange={v => updateSettings.mutate({ offlineEnabled: v })}
          />
        </div>
        <div className="p-4 space-y-2">
          {OFFLINE_CATALOG.map(c => {
            const row = offlineByType.get(c.type);
            const enabled = row?.isEnabled ?? (c.type === "pay_at_counter");
            return (
              <div key={c.type} className="flex items-start gap-3 border border-border rounded-lg p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={enabled}
                  onChange={e => upsertMethod.mutate({ category: "offline", type: c.type, isEnabled: e.target.checked })}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── ONLINE ─── */}
      <div className="border border-border rounded-xl bg-white">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">Online</p>
            <p className="text-xs text-muted-foreground">Customer picks one of these under "Pay Online" at checkout.</p>
          </div>
          <Toggle
            label="Accept online payments"
            checked={settings.onlineEnabled}
            onChange={v => updateSettings.mutate({ onlineEnabled: v })}
          />
        </div>

        {settings.onlineEnabled && (
          <div className="p-4 space-y-5">
            {/* Routing source — controls which sub-list the customer sees. */}
            <Field label="Online payment source" hint="What backs the customer's 'Pay Online' choice. Use 'Mixed' to expose multiple options.">
              <Select
                value={settings.onlinePaymentSource}
                onChange={v => updateSettings.mutate({ onlinePaymentSource: v as typeof settings.onlinePaymentSource })}
                options={[
                  { value: "platform_gateway", label: "Platform-managed gateway (Stripe / Razorpay / Cashfree set up by the team)" },
                  { value: "own_gateway", label: "Restaurant Own Payment Method — own gateway keys" },
                  { value: "manual_upi", label: "Restaurant Own Payment Method — Manual UPI only" },
                  { value: "mixed", label: "Mixed (show every enabled option)" },
                ]}
              />
            </Field>
            <Field label="Customer default" hint="Which top-level radio is preselected at checkout when both Counter and Online are available.">
              <Select
                value={settings.defaultCustomerChoice}
                onChange={v => updateSettings.mutate({ defaultCustomerChoice: v as typeof settings.defaultCustomerChoice })}
                options={[
                  { value: "pay_at_counter", label: "Pay at Counter" },
                  { value: "pay_online", label: "Pay Online" },
                ]}
              />
            </Field>

            {/* Platform-managed gateway */}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform-managed gateway</p>
              <p className="text-xs text-muted-foreground">Stripe / Razorpay / Cashfree configured by the platform team. Toggle here to surface them at checkout.</p>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={onlineByKey.get(onlineKey("platform_gateway", null))?.isEnabled ?? false}
                  onChange={e => upsertMethod.mutate({ category: "online", type: "platform_gateway", isEnabled: e.target.checked })}
                />
                <span className="text-sm">Enable platform gateway at checkout</span>
              </label>
            </div>

            {/* Restaurant Own Payment Method — Own gateway keys */}
            <div className="border border-border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Restaurant Own Payment Method</p>
              <p className="text-xs text-muted-foreground">Hook up your own gateway keys per provider, or enable Manual UPI below. Secret fields are encrypted at rest — only a masked preview is shown back to you on reload.</p>
              <div className="space-y-2">
                {ownGateways.map(g => {
                  const row = onlineByKey.get(onlineKey("own_gateway", g));
                  const enabled = row?.isEnabled ?? false;
                  const fields = GATEWAY_FIELDS[g] ?? [];
                  return (
                    <div key={g} className="border border-border rounded-lg overflow-hidden">
                      <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={e => upsertMethod.mutate({ category: "online", type: "own_gateway", gatewayCode: g, isEnabled: e.target.checked, label: `Pay with ${g.charAt(0).toUpperCase() + g.slice(1)}` })}
                        />
                        <span className="text-sm capitalize font-medium flex-1">{g}</span>
                        {enabled && fields.length > 0 && (
                          (() => {
                            const cfg = (row?.config ?? {}) as Record<string, unknown>;
                            const hasAnyKey = fields.some(f => {
                              const v = cfg[f.name];
                              if (typeof v === "string" && v.length > 0) return true;
                              if (v && typeof v === "object" && (v as { hasValue?: boolean }).hasValue) return true;
                              return false;
                            });
                            return (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${hasAnyKey ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                                {hasAnyKey ? "Keys configured" : "Keys required"}
                              </span>
                            );
                          })()
                        )}
                      </label>
                      {enabled && fields.length > 0 && (
                        <div className="border-t border-border bg-gray-50/50 p-3">
                          <OwnGatewayCredentialsForm
                            provider={g}
                            fields={fields}
                            existingConfig={(row?.config ?? {}) as Record<string, unknown>}
                            saving={upsertMethod.isPending}
                            onSave={(config) => upsertMethod.mutate({
                              category: "online",
                              type: "own_gateway",
                              gatewayCode: g,
                              isEnabled: true,
                              label: `Pay with ${g.charAt(0).toUpperCase() + g.slice(1)}`,
                              config,
                            })}
                          />
                        </div>
                      )}
                      {enabled && fields.length === 0 && (
                        <div className="border-t border-border bg-amber-50/50 p-3 text-xs text-amber-800">
                          No credential template available for this provider yet — contact support to enable it.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Manual UPI — lives under Online > Restaurant Own Payment Method */}
            <div className="border border-border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual UPI <span className="normal-case text-[10px] text-muted-foreground/80">(under Restaurant Own Payment Method)</span></p>
                  <p className="text-xs text-muted-foreground">Diners pay to your VPA, then enter UTR / upload screenshot for confirmation.</p>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={onlineByKey.get(onlineKey("manual_upi", null))?.isEnabled ?? false}
                    onChange={e => upsertMethod.mutate({ category: "online", type: "manual_upi", isEnabled: e.target.checked, label: "UPI (Restaurant's own)" })}
                  />
                  <span>Enable</span>
                </label>
              </div>
              <ManualUpiIdentityForm
                initialVpa={manualUpi?.upiId ?? ""}
                initialMerchantName={manualUpi?.merchantName ?? ""}
                onSave={(vpa, merchantName) =>
                  upsertManualUpi.mutate({
                    upiId: vpa || null,
                    merchantName: merchantName || null,
                  })
                }
                saving={upsertManualUpi.isPending}
              />
              <Row>
                <Toggle label="Show dynamic QR" checked={manualUpi?.enableDynamicQr ?? true} onChange={v => upsertManualUpi.mutate({ enableDynamicQr: v })} />
                <Toggle label="Show intent link (mobile)" checked={manualUpi?.enableIntentLink ?? true} onChange={v => upsertManualUpi.mutate({ enableIntentLink: v })} />
              </Row>
              <Row>
                <Toggle label="Require UTR / reference" checked={manualUpi?.requireUtr ?? true} onChange={v => upsertManualUpi.mutate({ requireUtr: v })} />
                <Toggle label="Allow screenshot upload" checked={manualUpi?.allowScreenshotUpload ?? true} onChange={v => upsertManualUpi.mutate({ allowScreenshotUpload: v })} />
              </Row>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Per-provider credential editor. Each input is controlled with local state,
 * secret fields render as password inputs pre-filled with the masked
 * preview returned by the API ("rzp…wxyz" etc.). Typing into a secret
 * field replaces it; leaving it untouched leaves the stored value alone
 * (the backend ignores empty secret strings on update). Public fields
 * (key_id, merchant_id, salt_index) are normal text inputs with the
 * actual stored value. */
function OwnGatewayCredentialsForm({
  provider,
  fields,
  existingConfig,
  saving,
  onSave,
}: {
  provider: string;
  fields: Array<{ name: string; label: string; secret: boolean; placeholder?: string }>;
  existingConfig: Record<string, unknown>;
  saving: boolean;
  onSave: (config: Record<string, unknown>) => void;
}) {
  // Initial values: secrets default to "" (so an unchanged field sends ""
  // and the backend keeps the stored cipher). Non-secret fields are
  // populated with the stored plain value so the admin can see what's set.
  const readInitial = (f: { name: string; secret: boolean }) => {
    const v = existingConfig[f.name];
    if (f.secret) return "";
    return typeof v === "string" ? v : "";
  };
  const initial = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of fields) o[f.name] = readInitial(f);
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, JSON.stringify(existingConfig)]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setValues(initial); }, [initial]);
  const previewFor = (name: string): string | null => {
    const v = existingConfig[name];
    if (v && typeof v === "object" && (v as { __secret?: boolean }).__secret) {
      return (v as { preview?: string }).preview ?? null;
    }
    return null;
  };
  const dirty = fields.some(f => values[f.name] !== initial[f.name]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(f => {
          const preview = f.secret ? previewFor(f.name) : null;
          return (
            <Field
              key={f.name}
              label={f.label}
              hint={preview ? `Currently stored: ${preview} — leave blank to keep, type to replace.` : undefined}
            >
              <Input
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "new-password" : "off"}
                value={values[f.name] ?? ""}
                placeholder={f.secret && preview ? "•••••••• (unchanged)" : (f.placeholder ?? "")}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
              />
            </Field>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            // Only send fields the admin actually touched, so unchanged
            // secret fields aren't transmitted (and aren't logged) at all.
            const patch: Record<string, unknown> = {};
            for (const f of fields) {
              if (values[f.name] !== initial[f.name]) patch[f.name] = values[f.name];
            }
            onSave(patch);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 2000);
          }}
        >
          {saving ? "Saving…" : dirty ? `Save ${provider} keys` : "Saved"}
        </Button>
        {savedFlash && !dirty && !saving && (
          <span className="text-xs text-green-700 font-medium">✓ Saved</span>
        )}
        {dirty && !saving && (
          <span className="text-xs text-amber-700 font-medium">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

/* Controlled VPA + merchant-name editor with an explicit Save button so a
 * typed value isn't lost if the admin closes the panel before blurring the
 * field. Also flags personal-tier VPAs (which PhonePe/Paytm reject under
 * the 2024 NPCI risk policy) and nudges the admin toward a merchant VPA. */
function ManualUpiIdentityForm({
  initialVpa,
  initialMerchantName,
  onSave,
  saving,
}: {
  initialVpa: string;
  initialMerchantName: string;
  onSave: (vpa: string, merchantName: string) => void;
  saving: boolean;
}) {
  const [vpa, setVpa] = useState(initialVpa);
  const [merchantName, setMerchantName] = useState(initialMerchantName);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setVpa(initialVpa); }, [initialVpa]);
  useEffect(() => { setMerchantName(initialMerchantName); }, [initialMerchantName]);
  const dirty = vpa !== initialVpa || merchantName !== initialMerchantName;
  // Personal-tier handles that NPCI member apps now decline for collect-style
  // intents. Merchant-tier handles look like @paytm, @ybl-merchant,
  // @okhdfcbankmerchant, or the bank's explicit P2M suffixes.
  const PERSONAL_SUFFIXES = ["@ybl", "@ibl", "@axl", "@apl", "@okhdfcbank", "@okicici", "@oksbi", "@okaxis", "@upi", "@paytm"];
  const handle = vpa.trim().toLowerCase();
  const looksPersonal = handle.length > 0 && PERSONAL_SUFFIXES.some(s => handle.endsWith(s)) && !handle.includes("merchant");
  return (
    <div className="space-y-3">
      <Row>
        <Field label="UPI ID / VPA">
          <Input
            placeholder="merchantname@paytm or merchantname@hdfcbankmerchant"
            value={vpa}
            onChange={e => setVpa(e.target.value)}
          />
        </Field>
        <Field label="Merchant name shown to customer">
          <Input
            placeholder="Your Restaurant Pvt Ltd"
            value={merchantName}
            onChange={e => setMerchantName(e.target.value)}
          />
        </Field>
      </Row>
      {looksPersonal && (
        <div className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
          <p className="font-semibold">Heads up — this looks like a personal UPI ID.</p>
          <p className="mt-1">PhonePe and Paytm now block payment intents to personal handles under the NPCI 2024 risk policy. Ask your bank for a merchant / P2M VPA (e.g. <span className="font-mono">name@paytm</span>, <span className="font-mono">name@hdfcbankmerchant</span>, <span className="font-mono">name@ybl-merchant</span>) so customers can actually pay you.</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            onSave(vpa.trim(), merchantName.trim());
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 2000);
          }}
        >
          {saving ? "Saving…" : dirty ? "Save UPI ID" : "Saved"}
        </Button>
        {savedFlash && !dirty && !saving && (
          <span className="text-xs text-green-700 font-medium">✓ Saved</span>
        )}
        {dirty && !saving && (
          <span className="text-xs text-amber-700 font-medium">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- 10. Theme ---------------- */
interface ThemeCfg {
  mode: "light" | "dark" | "system";
  primaryColor: string; accentColor: string;
  logoUrl: string; faviconUrl: string; loginBgUrl: string;
}
function ThemeSection() {
  const defaults: ThemeCfg = {
    mode: "system", primaryColor: "#f97316", accentColor: "#fb923c",
    logoUrl: "", faviconUrl: "", loginBgUrl: "",
  };
  return (
    <SettingForm section="theme" defaults={defaults}
      description="Brand colors and assets. Color values accept any CSS color (hex, rgb, hsl).">
      {(s, set) => (
        <>
          <Field label="Color scheme">
            <Select value={s.mode} onChange={v => set(p => ({ ...p, mode: v as ThemeCfg["mode"] }))} options={[
              { value: "system", label: "Match system" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" },
            ]} />
          </Field>
          <Row>
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <input type="color" value={s.primaryColor} onChange={e => set(p => ({ ...p, primaryColor: e.target.value }))} className="h-9 w-12 border border-border rounded" />
                <Input value={s.primaryColor} onChange={e => set(p => ({ ...p, primaryColor: e.target.value }))} />
              </div>
            </Field>
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input type="color" value={s.accentColor} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))} className="h-9 w-12 border border-border rounded" />
                <Input value={s.accentColor} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))} />
              </div>
            </Field>
          </Row>
          <ImageUploadField label="Logo" value={s.logoUrl} onChange={(v) => set(p => ({ ...p, logoUrl: v }))} compact />
          <ImageUploadField label="Favicon" value={s.faviconUrl} onChange={(v) => set(p => ({ ...p, faviconUrl: v }))} compact previewSize={64} />
          <ImageUploadField label="Login background image" value={s.loginBgUrl} onChange={(v) => set(p => ({ ...p, loginBgUrl: v }))} />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 11. Roles ---------------- */
const RESOURCES = ["orders", "menu", "tables", "kitchen", "inventory", "staff", "customers", "reports", "settings", "payments", "expenses"];
const ACTIONS = ["view", "create", "edit", "delete"];
type PermissionMatrix = Record<string, Record<string, Record<string, boolean>>>; // role -> resource -> action -> bool
interface RolesCfg {
  customRoles: { id: string; name: string }[];
  matrix: PermissionMatrix;
}
function RolesSection() {
  const defaultMatrix: PermissionMatrix = {
    owner: Object.fromEntries(RESOURCES.map(r => [r, Object.fromEntries(ACTIONS.map(a => [a, true]))])),
    manager: Object.fromEntries(RESOURCES.map(r => [r, Object.fromEntries(ACTIONS.map(a => [a, r !== "settings" && a !== "delete" ? true : a === "view"]))])),
    waiter: Object.fromEntries(RESOURCES.map(r => [r, Object.fromEntries(ACTIONS.map(a => [a, ["orders", "tables", "menu", "customers"].includes(r) && a !== "delete"]))])),
    kitchen: Object.fromEntries(RESOURCES.map(r => [r, Object.fromEntries(ACTIONS.map(a => [a, ["kitchen", "menu"].includes(r) && a === "view"]))])),
  };
  const defaults: RolesCfg = { customRoles: [], matrix: defaultMatrix };

  return (
    <SettingForm section="roles" defaults={defaults}
      description="Granular permissions per role. Owners always have full access. Custom roles inherit from the manager template.">
      {(s, set) => {
        const allRoles = ["owner", "manager", "waiter", "kitchen", ...s.customRoles.map(r => r.id)];
        return (
          <>
            <ListEditor
              items={s.customRoles}
              onChange={items => {
                const matrix = { ...s.matrix };
                for (const cr of items) if (!matrix[cr.id]) matrix[cr.id] = JSON.parse(JSON.stringify(s.matrix.manager));
                set(p => ({ ...p, customRoles: items, matrix }));
              }}
              addLabel="Add custom role"
              makeNew={() => ({ id: `role-${Date.now()}`, name: "" })}
              render={(item, _i, update, remove) => (
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="Display name (e.g. Floor Supervisor)" value={item.name} onChange={e => update({ name: e.target.value })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              )}
            />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Permission matrix</p>
            <div className="overflow-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Resource</th>
                    {allRoles.map(r => (
                      <th key={r} colSpan={ACTIONS.length} className="text-center px-2 py-2 border-l border-border capitalize">{r.replace("role-", "")}</th>
                    ))}
                  </tr>
                  <tr className="text-muted-foreground bg-muted/10">
                    <th></th>
                    {allRoles.flatMap(r => ACTIONS.map(a => <th key={`${r}-${a}`} className="text-center px-2 py-1 font-normal">{a}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map(res => (
                    <tr key={res} className="border-t border-border">
                      <td className="px-3 py-2 font-medium capitalize">{res}</td>
                      {allRoles.flatMap(r => ACTIONS.map(a => {
                        const checked = !!s.matrix[r]?.[res]?.[a];
                        const isOwner = r === "owner";
                        return (
                          <td key={`${r}-${res}-${a}`} className="text-center px-1 py-1">
                            <input type="checkbox" checked={checked} disabled={isOwner}
                              onChange={e => set(p => ({
                                ...p,
                                matrix: { ...p.matrix, [r]: { ...p.matrix[r], [res]: { ...(p.matrix[r]?.[res] ?? {}), [a]: e.target.checked } } },
                              }))} />
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </SettingForm>
  );
}

/* ---------------- 12. Billing ---------------- */
function BillingSection() {
  const RESTAURANT_ID = useRestaurantId();
  const { data } = useSubscription(RESTAURANT_ID);
  const tenant = data?.tenant; const plan = data?.plan;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Billing summary and invoice history. Plan changes are managed in the Subscription page.</p>
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Current plan", value: plan?.name ?? "Trial" },
          { label: "Status", value: tenant?.planStatus ?? "—" },
          { label: "Renews on", value: tenant?.subscriptionEndsAt ? new Date(tenant.subscriptionEndsAt).toLocaleDateString() : "—" },
          { label: "Payment method", value: tenant?.stripeCustomerId ? "On file (via Stripe)" : "Not configured" },
        ].map(x => (
          <div key={x.label} className="border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{x.label}</p>
            <p className="font-medium text-foreground mt-1">{x.value}</p>
          </div>
        ))}
      </div>
      <Link href="/settings/subscription" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        Manage plan & view invoices <ExternalLink className="w-3.5 h-3.5" />
      </Link>

      <SettingForm section="billing" defaults={{ billingEmail: "" }}>
        {(s, set) => (
          <Field label="Billing email" hint="Where invoices and renewal reminders are sent.">
            <Input type="email" value={s.billingEmail} onChange={e => set(p => ({ ...p, billingEmail: e.target.value }))} />
          </Field>
        )}
      </SettingForm>
    </div>
  );
}

/* ---------------- 13. Reservation ---------------- */
interface ReservationCfg {
  enabled: boolean; defaultPartyCap: number;
  requireName: boolean; requirePhone: boolean; requireEmail: boolean;
  depositPolicy: "none" | "fixed" | "perPerson"; depositAmount: number;
  leadMinutesMin: number; leadMinutesMax: number; slotMinutes: number;
  blackoutDates: string[]; autoConfirm: boolean; cancelPolicy: string;
}
function ReservationSection() {
  const defaults: ReservationCfg & {
    gracePeriodMinutes: number; reminderMinutes: number; autoNoShow: boolean;
    waitlistEnabled: boolean; askOccasion: boolean;
  } = {
    enabled: true, defaultPartyCap: 8,
    requireName: true, requirePhone: true, requireEmail: false,
    depositPolicy: "none", depositAmount: 0,
    leadMinutesMin: 60, leadMinutesMax: 60 * 24 * 30, slotMinutes: 30,
    blackoutDates: [], autoConfirm: true,
    cancelPolicy: "Cancellations within 2 hours of the reservation may incur a fee.",
    gracePeriodMinutes: 15,
    reminderMinutes: 60,
    autoNoShow: true,
    waitlistEnabled: true,
    askOccasion: true,
  };
  return (
    <SettingForm section="reservation" defaults={defaults}>
      {(s, set) => (
        <>
          <Toggle label="Accept reservations" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <Row>
            <Field label="Max party size"><Input type="number" value={s.defaultPartyCap} onChange={e => set(p => ({ ...p, defaultPartyCap: Number(e.target.value) }))} /></Field>
            <Field label="Slot length (minutes)"><Input type="number" value={s.slotMinutes} onChange={e => set(p => ({ ...p, slotMinutes: Number(e.target.value) }))} /></Field>
          </Row>
          <Row>
            <Field label="Min lead time (minutes)"><Input type="number" value={s.leadMinutesMin} onChange={e => set(p => ({ ...p, leadMinutesMin: Number(e.target.value) }))} /></Field>
            <Field label="Max lead time (minutes)"><Input type="number" value={s.leadMinutesMax} onChange={e => set(p => ({ ...p, leadMinutesMax: Number(e.target.value) }))} /></Field>
          </Row>
          <Field label="Required fields">
            <div className="flex gap-3 text-sm">
              {[
                ["requireName", "Name"], ["requirePhone", "Phone"], ["requireEmail", "Email"],
              ].map(([k, l]) => (
                <label key={k as string} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={(s as unknown as Record<string, boolean>)[k as string]}
                    onChange={e => set(p => ({ ...p, [k as string]: e.target.checked }) as typeof p)} />
                  {l}
                </label>
              ))}
            </div>
          </Field>
          <Row>
            <Field label="Deposit policy">
              <Select value={s.depositPolicy} onChange={v => set(p => ({ ...p, depositPolicy: v as ReservationCfg["depositPolicy"] }))} options={[
                { value: "none", label: "No deposit" }, { value: "fixed", label: "Fixed amount" }, { value: "perPerson", label: "Per person" },
              ]} />
            </Field>
            <Field label="Deposit amount" hint="Ignored if policy is None.">
              <Input type="number" value={s.depositAmount} onChange={e => set(p => ({ ...p, depositAmount: Number(e.target.value) }))} />
            </Field>
          </Row>
          <Toggle label="Auto-confirm reservations" hint="Otherwise, staff must manually confirm each booking."
            checked={s.autoConfirm} onChange={v => set(p => ({ ...p, autoConfirm: v }))} />
          <Row>
            <Field label="Reminder lead time (minutes)" hint="Email/WhatsApp reminder fires this many minutes before scheduled time.">
              <Input type="number" value={s.reminderMinutes} onChange={e => set(p => ({ ...p, reminderMinutes: Number(e.target.value) }))} />
            </Field>
            <Field label="Grace period (minutes)" hint="Auto-mark as no-show this many minutes after start.">
              <Input type="number" value={s.gracePeriodMinutes} onChange={e => set(p => ({ ...p, gracePeriodMinutes: Number(e.target.value) }))} />
            </Field>
          </Row>
          <Toggle label="Auto no-show" hint="When ON, late reservations are automatically marked no-show after the grace period."
            checked={s.autoNoShow} onChange={v => set(p => ({ ...p, autoNoShow: v }))} />
          <Toggle label="Enable walk-in waitlist" checked={s.waitlistEnabled} onChange={v => set(p => ({ ...p, waitlistEnabled: v }))} />
          <Toggle label="Ask guests about occasion" hint="Show birthday/anniversary/etc. dropdown on the public booking page."
            checked={s.askOccasion} onChange={v => set(p => ({ ...p, askOccasion: v }))} />
          <Field label="Blackout dates (comma-separated YYYY-MM-DD)">
            <Input value={s.blackoutDates.join(",")} onChange={e => set(p => ({ ...p, blackoutDates: e.target.value.split(",").map(x => x.trim()).filter(Boolean) }))} />
          </Field>
          <Field label="Cancellation / no-show policy text"><Textarea rows={3} value={s.cancelPolicy} onChange={e => set(p => ({ ...p, cancelPolicy: e.target.value }))} /></Field>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 14. About Us ---------------- */
interface TeamMember { name: string; role: string; photoUrl: string; }
interface AboutCfg {
  story: string; mission: string; heroImage: string;
  gallery: string[]; awards: string;
  team: TeamMember[];
}
function AboutSection() {
  const defaults: AboutCfg = { story: "", mission: "", heroImage: "", gallery: [], awards: "", team: [] };
  return (
    <SettingForm section="about-us" defaults={defaults}
      description="Used on the public customer site About page.">
      {(s, set) => (
        <>
          <Field label="Story"><Textarea rows={4} value={s.story} onChange={e => set(p => ({ ...p, story: e.target.value }))} /></Field>
          <Field label="Mission"><Textarea rows={2} value={s.mission} onChange={e => set(p => ({ ...p, mission: e.target.value }))} /></Field>
          <ImageUploadField label="Hero image" value={s.heroImage} onChange={(v) => set(p => ({ ...p, heroImage: v }))} />
          <Field label="Awards & recognition"><Textarea rows={2} value={s.awards} onChange={e => set(p => ({ ...p, awards: e.target.value }))} /></Field>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Photo gallery</p>
          <ListEditor
            items={s.gallery.map(url => ({ url }))}
            onChange={items => set(p => ({ ...p, gallery: items.map(x => x.url).filter(Boolean) }))}
            addLabel="Add gallery image"
            makeNew={() => ({ url: "" })}
            render={(item, _i, update, remove) => (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <ImageUploadField label="" value={item.url} onChange={(v) => update({ url: v })} compact previewSize={96} />
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Team members</p>
          <ListEditor
            items={s.team}
            onChange={items => set(p => ({ ...p, team: items }))}
            addLabel="Add team member"
            makeNew={() => ({ name: "", role: "", photoUrl: "" })}
            render={(item, _i, update, remove) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="Name" value={item.name} onChange={e => update({ name: e.target.value })} />
                  <Input className="flex-1" placeholder="Role" value={item.role} onChange={e => update({ role: e.target.value })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
                <ImageUploadField label="Photo" value={item.photoUrl} onChange={(v) => update({ photoUrl: v })} compact previewSize={72} />
              </div>
            )}
          />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 15. Customer Site ---------------- */
interface Testimonial { name: string; quote: string; rating: number; avatarUrl: string }
interface CustomerSiteCfg {
  enabled: boolean; subdomain: string;
  heroHeadline: string; heroSubcopy: string;
  featuredItemIds: number[];
  socials: { instagram: string; facebook: string; twitter: string; youtube: string; tiktok: string };
  mapEmbedUrl: string;
  seoTitle: string; seoDescription: string; ogImageUrl: string;
  accentColor: string;
  ctaPrimaryLabel: string; ctaSecondaryLabel: string; ctaReserveLabel: string;
  showOpenClosedPill: boolean;
  testimonials: Testimonial[];
  analyticsGa4: string; analyticsFbPixel: string;
}
function CustomerSiteSection() {
  const defaults: CustomerSiteCfg = {
    enabled: false, subdomain: "",
    heroHeadline: "", heroSubcopy: "",
    featuredItemIds: [],
    socials: { instagram: "", facebook: "", twitter: "", youtube: "", tiktok: "" },
    mapEmbedUrl: "", seoTitle: "", seoDescription: "", ogImageUrl: "",
    accentColor: "#c2410c",
    ctaPrimaryLabel: "", ctaSecondaryLabel: "", ctaReserveLabel: "",
    showOpenClosedPill: true,
    testimonials: [],
    analyticsGa4: "", analyticsFbPixel: "",
  };
  return (
    <SettingForm section="customer-site" defaults={defaults}>
      {(s, set) => (
        <CustomerSiteEditor s={s} set={set} />
      )}
    </SettingForm>
  );
}

function CustomerSiteEditor({ s, set }: { s: CustomerSiteCfg; set: (updater: (p: CustomerSiteCfg) => CustomerSiteCfg) => void }) {
  const { data: restaurant } = useRestaurantInfo();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const slug = restaurant?.slug ?? "";
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const sitePath = slug ? `${base}/site/${encodeURIComponent(slug)}` : "";
  const fullUrl = slug ? `${window.location.origin}${sitePath}` : "";

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string } | null;
      if (msg?.type === "tabletrack:public-site:ready") setIframeReady(true);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!iframeReady) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: "tabletrack:public-site:preview",
      site: {
        heroHeadline: s.heroHeadline, heroSubcopy: s.heroSubcopy,
        socials: s.socials, mapEmbedUrl: s.mapEmbedUrl,
        seoTitle: s.seoTitle, seoDescription: s.seoDescription,
        ogImageUrl: s.ogImageUrl, accentColor: s.accentColor,
        ctaPrimaryLabel: s.ctaPrimaryLabel, ctaSecondaryLabel: s.ctaSecondaryLabel,
        ctaReserveLabel: s.ctaReserveLabel,
        showOpenClosedPill: s.showOpenClosedPill,
        testimonials: s.testimonials,
      },
    }, window.location.origin);
  }, [iframeReady, s.heroHeadline, s.heroSubcopy, s.socials, s.mapEmbedUrl, s.seoTitle, s.seoDescription, s.ogImageUrl, s.accentColor, s.ctaPrimaryLabel, s.ctaSecondaryLabel, s.ctaReserveLabel, s.showOpenClosedPill, s.testimonials]);

  function copyUrl() {
    if (!fullUrl) return;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
      <div className="space-y-3">
          <Toggle label="Public customer site enabled" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <Field label="Public URL slug" hint="Your public site lives at /site/<restaurant slug>. Update the restaurant slug under Restaurant settings to change it.">
            <Input value={slug} disabled />
          </Field>
          <Field label="Hero headline"><Input value={s.heroHeadline} onChange={e => set(p => ({ ...p, heroHeadline: e.target.value }))} /></Field>
          <Field label="Hero sub-copy"><Textarea rows={2} value={s.heroSubcopy} onChange={e => set(p => ({ ...p, heroSubcopy: e.target.value }))} /></Field>
          <Field label="Featured item IDs (comma-separated)">
            <Input value={s.featuredItemIds.join(",")} onChange={e => set(p => ({ ...p, featuredItemIds: e.target.value.split(",").map(x => Number(x.trim())).filter(n => !isNaN(n)) }))} />
          </Field>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Socials</p>
          <Row>
            <Field label="Instagram URL"><Input value={s.socials.instagram} onChange={e => set(p => ({ ...p, socials: { ...p.socials, instagram: e.target.value } }))} /></Field>
            <Field label="Facebook URL"><Input value={s.socials.facebook} onChange={e => set(p => ({ ...p, socials: { ...p.socials, facebook: e.target.value } }))} /></Field>
          </Row>
          <Row>
            <Field label="Twitter / X URL"><Input value={s.socials.twitter} onChange={e => set(p => ({ ...p, socials: { ...p.socials, twitter: e.target.value } }))} /></Field>
            <Field label="YouTube URL"><Input value={s.socials.youtube} onChange={e => set(p => ({ ...p, socials: { ...p.socials, youtube: e.target.value } }))} /></Field>
          </Row>
          <Field label="TikTok URL"><Input value={s.socials.tiktok} onChange={e => set(p => ({ ...p, socials: { ...p.socials, tiktok: e.target.value } }))} /></Field>
          <Field label="Google Maps embed URL"><Input value={s.mapEmbedUrl} onChange={e => set(p => ({ ...p, mapEmbedUrl: e.target.value }))} /></Field>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">CTAs & hero</p>
          <Row>
            <Field label="Hero primary CTA label" hint='Default: "Reserve a table"'>
              <Input value={s.ctaPrimaryLabel} onChange={e => set(p => ({ ...p, ctaPrimaryLabel: e.target.value }))} placeholder="Reserve a table" />
            </Field>
            <Field label="Hero secondary CTA label" hint='Default: "View menu"'>
              <Input value={s.ctaSecondaryLabel} onChange={e => set(p => ({ ...p, ctaSecondaryLabel: e.target.value }))} placeholder="View menu" />
            </Field>
          </Row>
          <Field label="Header reserve button label" hint='Default: "Book a table"'>
            <Input value={s.ctaReserveLabel} onChange={e => set(p => ({ ...p, ctaReserveLabel: e.target.value }))} placeholder="Book a table" />
          </Field>
          <Toggle label='Show "Open now / Closed" pill in header'
            hint="Auto-computed from today's hours under Reservation settings."
            checked={s.showOpenClosedPill} onChange={v => set(p => ({ ...p, showOpenClosedPill: v }))} />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Testimonials</p>
          <p className="text-xs text-muted-foreground -mt-1">Shown as a "What guests say" section. The section hides itself when empty.</p>
          <ListEditor
            items={s.testimonials}
            onChange={items => set(p => ({ ...p, testimonials: items }))}
            addLabel="Add testimonial"
            makeNew={() => ({ name: "", quote: "", rating: 5, avatarUrl: "" })}
            render={(item, _i, update, remove) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="Guest name" value={item.name} onChange={e => update({ name: e.target.value })} />
                  <Input className="w-20" type="number" min={1} max={5} value={item.rating} onChange={e => update({ rating: Math.min(5, Math.max(1, Number(e.target.value) || 5)) })} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
                <Textarea rows={2} placeholder="Quote" value={item.quote} onChange={e => update({ quote: e.target.value })} />
                <ImageUploadField label="Avatar (optional)" value={item.avatarUrl} onChange={(v) => update({ avatarUrl: v })} compact previewSize={56} />
              </div>
            )}
          />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">SEO</p>
          <Field label="SEO title"><Input value={s.seoTitle} onChange={e => set(p => ({ ...p, seoTitle: e.target.value }))} /></Field>
          <Field label="SEO description"><Textarea rows={2} value={s.seoDescription} onChange={e => set(p => ({ ...p, seoDescription: e.target.value }))} /></Field>
          <ImageUploadField label="OG / Twitter share image" value={s.ogImageUrl} onChange={(v) => set(p => ({ ...p, ogImageUrl: v }))} />
          <Field label="Accent color (hex)" hint="Used for buttons, headings and highlights on the public site.">
            <div className="flex items-center gap-2">
              <input type="color" value={s.accentColor || "#c2410c"} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))}
                className="h-9 w-12 rounded border border-input bg-background cursor-pointer" />
              <Input value={s.accentColor} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))} className="flex-1" />
            </div>
          </Field>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Analytics (optional)</p>
          <p className="text-xs text-muted-foreground -mt-1">Paste IDs to enable tracking on the public site. No analytics UI is built in.</p>
          <Row>
            <Field label="Google Analytics 4 measurement ID" hint="e.g. G-XXXXXXXXXX">
              <Input value={s.analyticsGa4} onChange={e => set(p => ({ ...p, analyticsGa4: e.target.value }))} placeholder="G-XXXXXXXXXX" />
            </Field>
            <Field label="Facebook Pixel ID">
              <Input value={s.analyticsFbPixel} onChange={e => set(p => ({ ...p, analyticsFbPixel: e.target.value }))} placeholder="1234567890" />
            </Field>
          </Row>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDevice("desktop")}
              className={`h-7 px-2.5 text-xs rounded-md border ${device === "desktop" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
              Desktop
            </button>
            <button type="button" onClick={() => setDevice("mobile")}
              className={`h-7 px-2.5 text-xs rounded-md border ${device === "mobile" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}>
              Mobile
            </button>
          </div>
        </div>
        {fullUrl ? (
          <div className="flex items-center gap-2">
            <a href={sitePath} target="_blank" rel="noreferrer"
              className="flex-1 truncate text-xs font-mono px-3 h-9 rounded-md border border-input bg-muted/40 flex items-center hover:underline">
              {fullUrl}
            </a>
            <Button type="button" variant="outline" size="sm" onClick={copyUrl} className="h-9">
              {copied ? "Copied!" : "Copy URL"}
            </Button>
            <a href={sitePath} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline" size="sm" className="h-9 px-2"><ExternalLink className="w-3.5 h-3.5" /></Button>
            </a>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Set a slug above to generate the public URL.</p>
        )}
        <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
          {sitePath ? (
            <iframe ref={iframeRef} key={sitePath} src={sitePath} title="Public site preview"
              className={`block bg-white ${device === "mobile" ? "w-[390px] mx-auto" : "w-full"}`}
              style={{ height: "640px" }} />
          ) : (
            <div className="h-[640px] flex items-center justify-center text-sm text-muted-foreground">
              Save a slug to preview your site.
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Edits update the preview live. Save to publish them to your public site.</p>
      </div>
    </div>
  );
}

/* ---------------- 16. Receipt ---------------- */
interface ReceiptCfg {
  headerLogo: string; footerText: string;
  showTaxBreakdown: boolean; showTipLine: boolean; showModifiers: boolean;
  feedbackQrUrl: string;
  paperSize: "58mm" | "80mm" | "a5";
  fontSize: "small" | "medium" | "large";
  language: string;
}
function ReceiptSection() {
  const defaults: ReceiptCfg = {
    headerLogo: "", footerText: "Thank you for dining with us!",
    showTaxBreakdown: true, showTipLine: true, showModifiers: true,
    feedbackQrUrl: "",
    paperSize: "80mm", fontSize: "medium", language: "en",
  };
  return (
    <SettingForm section="receipt" defaults={defaults}>
      {(s, set) => (
        <>
          <Row>
            <Field label="Header logo URL"><Input value={s.headerLogo} onChange={e => set(p => ({ ...p, headerLogo: e.target.value }))} /></Field>
            <Field label="Feedback QR URL (optional)"><Input value={s.feedbackQrUrl} onChange={e => set(p => ({ ...p, feedbackQrUrl: e.target.value }))} /></Field>
          </Row>
          <Field label="Footer text"><Textarea rows={2} value={s.footerText} onChange={e => set(p => ({ ...p, footerText: e.target.value }))} /></Field>
          <Row>
            <Field label="Paper size">
              <Select value={s.paperSize} onChange={v => set(p => ({ ...p, paperSize: v as ReceiptCfg["paperSize"] }))} options={[
                { value: "58mm", label: "Thermal 58mm" }, { value: "80mm", label: "Thermal 80mm" }, { value: "a5", label: "A5" },
              ]} />
            </Field>
            <Field label="Font size">
              <Select value={s.fontSize} onChange={v => set(p => ({ ...p, fontSize: v as ReceiptCfg["fontSize"] }))} options={[
                { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" },
              ]} />
            </Field>
          </Row>
          <Field label="Language"><Input value={s.language} onChange={e => set(p => ({ ...p, language: e.target.value }))} /></Field>
          <Toggle label="Show GST / tax breakdown" checked={s.showTaxBreakdown} onChange={v => set(p => ({ ...p, showTaxBreakdown: v }))} />
          <Toggle label="Show tip line" checked={s.showTipLine} onChange={v => set(p => ({ ...p, showTipLine: v }))} />
          <Toggle label="Show modifiers / add-ons on receipt" checked={s.showModifiers} onChange={v => set(p => ({ ...p, showModifiers: v }))} />

          <div className="border border-border rounded-lg p-4 bg-muted/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Live preview</p>
            <div className={"mx-auto bg-white text-black p-4 rounded font-mono text-xs " + (s.paperSize === "58mm" ? "max-w-[180px]" : s.paperSize === "80mm" ? "max-w-[260px]" : "max-w-[400px]")}>
              {s.headerLogo && <img src={s.headerLogo} alt="" className="mx-auto h-10 mb-2" />}
              <p className="text-center font-bold mb-1">YOUR RESTAURANT</p>
              <p className="text-center text-[10px] mb-2">123 Main St · +91 90000 00000</p>
              <hr />
              <div className="flex justify-between"><span>Pizza Margherita</span><span>320.00</span></div>
              <div className="flex justify-between"><span>Iced Tea x2</span><span>180.00</span></div>
              <hr className="my-1" />
              <div className="flex justify-between"><span>Subtotal</span><span>500.00</span></div>
              {s.showTaxBreakdown && <div className="flex justify-between"><span>GST 5%</span><span>25.00</span></div>}
              <div className="flex justify-between font-bold"><span>Total</span><span>525.00</span></div>
              {s.showTipLine && <div className="mt-2 border-t border-dashed pt-1 flex justify-between"><span>Tip</span><span>______</span></div>}
              <p className="text-center mt-3 text-[10px]">{s.footerText}</p>
              {s.feedbackQrUrl && <p className="text-center mt-1 text-[10px]">[QR: feedback]</p>}
            </div>
          </div>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 17. Printer ---------------- */
interface PrinterCfg {
  defaultReceiptPrinter: string;
  receiptPrinterTarget: "browser" | "network";
  labelPrinter: string; labelPrinterEnabled: boolean;
  testPrintLastResult?: string;
}
function PrinterSection() {
  const defaults: PrinterCfg = {
    defaultReceiptPrinter: "", receiptPrinterTarget: "browser",
    labelPrinter: "", labelPrinterEnabled: false,
  };
  return (
    <SettingForm section="printer" defaults={defaults}
      description="Receipt and label printers. Per-station kitchen printers are configured in Kitchens & Stations.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Default receipt printer name"><Input value={s.defaultReceiptPrinter} onChange={e => set(p => ({ ...p, defaultReceiptPrinter: e.target.value }))} /></Field>
            <Field label="Receipt printer target">
              <Select value={s.receiptPrinterTarget} onChange={v => set(p => ({ ...p, receiptPrinterTarget: v as PrinterCfg["receiptPrinterTarget"] }))} options={[
                { value: "browser", label: "Browser print dialog" }, { value: "network", label: "Network (silent)" },
              ]} />
            </Field>
          </Row>
          <Toggle label="Use label printer" checked={s.labelPrinterEnabled} onChange={v => set(p => ({ ...p, labelPrinterEnabled: v }))} />
          {s.labelPrinterEnabled && <Field label="Label printer name"><Input value={s.labelPrinter} onChange={e => set(p => ({ ...p, labelPrinter: e.target.value }))} /></Field>}
          <Button variant="outline" onClick={() => window.print()} type="button">Test print</Button>
          <Link href="/settings/kitchens" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
            Configure per-station kitchen printers <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 18. Downloads ---------------- */
interface DownloadsCfg {
  delimiter: "," | ";" | "\t";
  includeHeaders: boolean;
  dateFormat: "ISO" | "DMY" | "MDY";
}
function DownloadsSection() {
  const defaults: DownloadsCfg = { delimiter: ",", includeHeaders: true, dateFormat: "ISO" };
  const sep = (d: DownloadsCfg["delimiter"]) => d === "\t" ? "\t" : d;
  const items = (d: DownloadsCfg["delimiter"]) => {
    const s = sep(d);
    return [
      { label: "Sample menu CSV template", file: "menu-template.csv", body: `name${s}price${s}category${s}description${s}is_veg\nMargherita${s}320${s}Pizza${s}Classic margherita${s}true\n` },
      { label: "Sample inventory CSV template", file: "inventory-template.csv", body: `name${s}unit${s}current_stock${s}min_stock${s}cost_per_unit\nFlour${s}kg${s}50${s}10${s}40\n` },
      { label: "Sample customers CSV template", file: "customers-template.csv", body: `name${s}phone${s}email${s}birthday\nJane Doe${s}9990001234${s}jane@example.com${s}1990-01-15\n` },
    ];
  };
  const download = (file: string, body: string, includeHeaders: boolean) => {
    const out = includeHeaders ? body : body.split("\n").slice(1).join("\n");
    const blob = new Blob([out], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = file; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <SettingForm section="downloads" defaults={defaults}>
      {(s, set) => (
        <>
          <p className="text-sm text-muted-foreground">Templates and resources for bulk imports and data exports.</p>
          <Row>
            <Field label="CSV delimiter">
              <Select value={s.delimiter} onChange={(v) => set(p => ({ ...p, delimiter: v }))}
                options={[{value:",",label:"Comma (,)"},{value:";",label:"Semicolon (;)"},{value:"\t",label:"Tab"}]} />
            </Field>
            <Field label="Date format">
              <Select value={s.dateFormat} onChange={(v) => set(p => ({ ...p, dateFormat: v }))}
                options={[{value:"ISO",label:"YYYY-MM-DD"},{value:"DMY",label:"DD/MM/YYYY"},{value:"MDY",label:"MM/DD/YYYY"}]} />
            </Field>
          </Row>
          <Toggle label="Include header row in exports" checked={s.includeHeaders} onChange={(v) => set(p => ({ ...p, includeHeaders: v }))} />
          <div className="space-y-2 pt-2">
            {items(s.delimiter).map(it => (
              <div key={it.file} className="flex items-center justify-between border border-border rounded-lg p-3">
                <div>
                  <p className="font-medium text-sm">{it.label}</p>
                  <p className="text-xs text-muted-foreground">{it.file}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => download(it.file, it.body, s.includeHeaders)}>
                  <FileDown className="w-3.5 h-3.5 mr-1.5" /> Download
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between border border-border rounded-lg p-3">
              <div>
                <p className="font-medium text-sm">Per-table QR codes</p>
                <p className="text-xs text-muted-foreground">Generate from the Tables page (each table has its own QR).</p>
              </div>
              <Link href="/tables"><Button variant="outline" size="sm">Open Tables</Button></Link>
            </div>
          </div>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 19. Menu Item Image ---------------- */
interface MenuImageCfg {
  aspectRatio: "1:1" | "4:3" | "16:9";
  maxUploadKb: number; autoCompress: boolean;
  fallbackPlaceholder: string; showInCustomerMenu: boolean;
}
function MenuImageSection() {
  const defaults: MenuImageCfg = {
    aspectRatio: "1:1", maxUploadKb: 1024, autoCompress: true,
    fallbackPlaceholder: "", showInCustomerMenu: true,
  };
  return (
    <SettingForm section="menu-image" defaults={defaults}>
      {(s, set) => (
        <>
          <Row>
            <Field label="Aspect ratio">
              <Select value={s.aspectRatio} onChange={v => set(p => ({ ...p, aspectRatio: v as MenuImageCfg["aspectRatio"] }))} options={[
                { value: "1:1", label: "Square 1:1" }, { value: "4:3", label: "4:3" }, { value: "16:9", label: "16:9" },
              ]} />
            </Field>
            <Field label="Max upload size (KB)"><Input type="number" value={s.maxUploadKb} onChange={e => set(p => ({ ...p, maxUploadKb: Number(e.target.value) }))} /></Field>
          </Row>
          <Toggle label="Auto-compress uploaded images" checked={s.autoCompress} onChange={v => set(p => ({ ...p, autoCompress: v }))} />
          <Field label="Fallback placeholder image URL"><Input value={s.fallbackPlaceholder} onChange={e => set(p => ({ ...p, fallbackPlaceholder: e.target.value }))} /></Field>
          <Toggle label="Display images in customer menu" checked={s.showInCustomerMenu} onChange={v => set(p => ({ ...p, showInCustomerMenu: v }))} />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 20. Delivery ---------------- */
interface DeliveryZone { id: string; name: string; fee: number; minOrder: number; }
interface DeliveryCfg {
  enabled: boolean; radiusKm: number; zones: DeliveryZone[];
  minOrderValue: number; freeDeliveryThreshold: number;
  prepMinutes: number; travelMinutes: number;
  zomato: boolean; swiggy: boolean; uberEats: boolean;
}
function DeliverySection() {
  const defaults: DeliveryCfg = {
    enabled: true, radiusKm: 5, zones: [{ id: "z1", name: "Inner zone (0-3km)", fee: 30, minOrder: 200 }],
    minOrderValue: 150, freeDeliveryThreshold: 500,
    prepMinutes: 15, travelMinutes: 20,
    zomato: false, swiggy: false, uberEats: false,
  };
  return (
    <SettingForm section="delivery" defaults={defaults}>
      {(s, set) => (
        <>
          <Toggle label="Delivery enabled" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <Row>
            <Field label="Delivery radius (km)"><Input type="number" value={s.radiusKm} onChange={e => set(p => ({ ...p, radiusKm: Number(e.target.value) }))} /></Field>
            <Field label="Min order value"><Input type="number" value={s.minOrderValue} onChange={e => set(p => ({ ...p, minOrderValue: Number(e.target.value) }))} /></Field>
          </Row>
          <Row>
            <Field label="Free-delivery threshold"><Input type="number" value={s.freeDeliveryThreshold} onChange={e => set(p => ({ ...p, freeDeliveryThreshold: Number(e.target.value) }))} /></Field>
            <Field label="Default prep + travel (min)" hint="Used to estimate ETA">
              <div className="flex items-center gap-2">
                <Input type="number" className="w-20" value={s.prepMinutes} onChange={e => set(p => ({ ...p, prepMinutes: Number(e.target.value) }))} />
                <span className="text-xs text-muted-foreground">prep +</span>
                <Input type="number" className="w-20" value={s.travelMinutes} onChange={e => set(p => ({ ...p, travelMinutes: Number(e.target.value) }))} />
                <span className="text-xs text-muted-foreground">travel</span>
              </div>
            </Field>
          </Row>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Delivery zones</p>
          <ListEditor
            items={s.zones}
            onChange={items => set(p => ({ ...p, zones: items }))}
            addLabel="Add zone"
            makeNew={() => ({ id: `z-${Date.now()}`, name: "", fee: 0, minOrder: 0 })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Zone name" value={item.name} onChange={e => update({ name: e.target.value })} />
                <Input className="w-24" type="number" placeholder="Fee" value={item.fee} onChange={e => update({ fee: Number(e.target.value) })} />
                <Input className="w-28" type="number" placeholder="Min order" value={item.minOrder} onChange={e => update({ minOrder: Number(e.target.value) })} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Third-party platforms</p>
          <p className="text-xs text-muted-foreground -mt-3">Display-only toggles. Live integrations require platform API keys (separate task).</p>
          <Toggle label="Zomato" checked={s.zomato} onChange={v => set(p => ({ ...p, zomato: v }))} />
          <Toggle label="Swiggy" checked={s.swiggy} onChange={v => set(p => ({ ...p, swiggy: v }))} />
          <Toggle label="Uber Eats" checked={s.uberEats} onChange={v => set(p => ({ ...p, uberEats: v }))} />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 21. Allergens ---------------- */
const EU_ALLERGENS = [
  { id: "gluten", label: "Cereals containing gluten", icon: "🌾" },
  { id: "crustaceans", label: "Crustaceans", icon: "🦐" },
  { id: "eggs", label: "Eggs", icon: "🥚" },
  { id: "fish", label: "Fish", icon: "🐟" },
  { id: "peanuts", label: "Peanuts", icon: "🥜" },
  { id: "soybeans", label: "Soybeans", icon: "🫘" },
  { id: "milk", label: "Milk (lactose)", icon: "🥛" },
  { id: "nuts", label: "Tree nuts", icon: "🌰" },
  { id: "celery", label: "Celery", icon: "🥬" },
  { id: "mustard", label: "Mustard", icon: "🟡" },
  { id: "sesame", label: "Sesame seeds", icon: "🟤" },
  { id: "sulphites", label: "Sulphur dioxide / sulphites", icon: "⚗️" },
  { id: "lupin", label: "Lupin", icon: "🌸" },
  { id: "molluscs", label: "Molluscs", icon: "🦪" },
];
interface AllergensCfg {
  enabled: boolean; activeAllergens: string[];
  display: "icon" | "text" | "iconAndText";
  showOnCustomerMenu: boolean;
}
function AllergensSection() {
  const defaults: AllergensCfg = {
    enabled: true, activeAllergens: EU_ALLERGENS.map(a => a.id),
    display: "iconAndText", showOnCustomerMenu: true,
  };
  return (
    <SettingForm section="allergens" defaults={defaults}
      description="EU 1169/2011 mandates declaration of these 14 allergens. Mark which ones to track; tag items in the Menu page.">
      {(s, set) => (
        <>
          <Toggle label="Allergen tracking enabled" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">14 allergens</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {EU_ALLERGENS.map(a => (
              <label key={a.id} className={"flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer " + (s.activeAllergens.includes(a.id) ? "border-primary bg-primary/5" : "border-border")}>
                <input type="checkbox" checked={s.activeAllergens.includes(a.id)}
                  onChange={e => set(p => ({ ...p, activeAllergens: e.target.checked ? [...p.activeAllergens, a.id] : p.activeAllergens.filter(x => x !== a.id) }))} />
                <span className="text-base">{a.icon}</span>
                <span className="text-sm">{a.label}</span>
              </label>
            ))}
          </div>
          <Field label="Display style on customer menu">
            <Select value={s.display} onChange={v => set(p => ({ ...p, display: v as AllergensCfg["display"] }))} options={[
              { value: "icon", label: "Icon only" }, { value: "text", label: "Text only" }, { value: "iconAndText", label: "Icon + text" },
            ]} />
          </Field>
          <Toggle label="Show allergens on customer menu" checked={s.showOnCustomerMenu} onChange={v => set(p => ({ ...p, showOnCustomerMenu: v }))} />
          <Link href="/menu" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Tag allergens on items <ExternalLink className="w-3.5 h-3.5" /></Link>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 22. KOT ---------------- */
interface KotCfg {
  format: "chit" | "strip";
  includeModifiers: boolean; includeAllergens: boolean; includeGuestName: boolean; includeTableSeat: boolean;
  voidReasonRequired: boolean;
  courseFiring: "auto" | "manual";
}
function KotSection() {
  const defaults: KotCfg = {
    format: "chit",
    includeModifiers: true, includeAllergens: true, includeGuestName: false, includeTableSeat: true,
    voidReasonRequired: true,
    courseFiring: "manual",
  };
  return (
    <SettingForm section="kot" defaults={defaults}
      description="Kitchen Order Ticket layout and behavior at the KDS / kitchen printer.">
      {(s, set) => (
        <>
          <Field label="Format">
            <Select value={s.format} onChange={v => set(p => ({ ...p, format: v as KotCfg["format"] }))} options={[
              { value: "chit", label: "Chit (full ticket per order)" }, { value: "strip", label: "Strip (one line per item)" },
            ]} />
          </Field>
          <Toggle label="Include modifiers" checked={s.includeModifiers} onChange={v => set(p => ({ ...p, includeModifiers: v }))} />
          <Toggle label="Include allergens" checked={s.includeAllergens} onChange={v => set(p => ({ ...p, includeAllergens: v }))} />
          <Toggle label="Include guest name" checked={s.includeGuestName} onChange={v => set(p => ({ ...p, includeGuestName: v }))} />
          <Toggle label="Include table & seat #" checked={s.includeTableSeat} onChange={v => set(p => ({ ...p, includeTableSeat: v }))} />
          <Toggle label="Require reason on void" checked={s.voidReasonRequired} onChange={v => set(p => ({ ...p, voidReasonRequired: v }))} />
          <Field label="Course firing">
            <Select value={s.courseFiring} onChange={v => set(p => ({ ...p, courseFiring: v as KotCfg["courseFiring"] }))} options={[
              { value: "manual", label: "Manual (waiter fires each course)" }, { value: "auto", label: "Auto (fire all on order placement)" },
            ]} />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 23. Cancellation reasons ---------------- */
interface ReasonRow { id: string; label: string; isActive: boolean; }
interface ReasonsCfg { reasons: ReasonRow[] }
function CancellationReasonsSection() {
  const defaults: ReasonsCfg = { reasons: [
    { id: "changed-mind", label: "Customer changed mind", isActive: true },
    { id: "out-of-stock", label: "Out of stock", isActive: true },
    { id: "wrong-item", label: "Wrong item ordered", isActive: true },
    { id: "long-wait", label: "Long wait", isActive: true },
    { id: "other", label: "Other", isActive: true },
  ]};
  return (
    <SettingForm section="cancellation-reasons" defaults={defaults}
      description="Reasons available in the order cancellation modal. Disabled reasons are hidden.">
      {(s, set) => (
        <ListEditor
          items={s.reasons}
          onChange={items => set(p => ({ ...p, reasons: items }))}
          addLabel="Add reason"
          makeNew={() => ({ id: `r-${Date.now()}`, label: "", isActive: true })}
          render={(item, _i, update, remove) => (
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={item.label} onChange={e => update({ label: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={item.isActive} onChange={e => update({ isActive: e.target.checked })} /> Active</label>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        />
      )}
    </SettingForm>
  );
}

/* ---------------- 24. Order Settings ---------------- */
interface OrderSettingsCfg {
  autoAccept: boolean; defaultOrderType: "dine-in" | "takeaway" | "delivery";
  numberPrefix: string; counterReset: "never" | "daily" | "monthly";
  holdAndFire: boolean; maxGuestsPerTable: number; courseService: boolean;
}
function OrderSettingsSection() {
  const defaults: OrderSettingsCfg = {
    autoAccept: true, defaultOrderType: "dine-in",
    numberPrefix: "ORD", counterReset: "daily",
    holdAndFire: false, maxGuestsPerTable: 12, courseService: false,
  };
  return (
    <SettingForm section="order-settings" defaults={defaults}>
      {(s, set) => (
        <>
          <Toggle label="Auto-accept new orders" checked={s.autoAccept} onChange={v => set(p => ({ ...p, autoAccept: v }))} />
          <Row>
            <Field label="Default order type">
              <Select value={s.defaultOrderType} onChange={v => set(p => ({ ...p, defaultOrderType: v as OrderSettingsCfg["defaultOrderType"] }))} options={[
                { value: "dine-in", label: "Dine-in" }, { value: "takeaway", label: "Takeaway" }, { value: "delivery", label: "Delivery" },
              ]} />
            </Field>
            <Field label="Order number prefix"><Input value={s.numberPrefix} onChange={e => set(p => ({ ...p, numberPrefix: e.target.value }))} /></Field>
          </Row>
          <Row>
            <Field label="Counter reset">
              <Select value={s.counterReset} onChange={v => set(p => ({ ...p, counterReset: v as OrderSettingsCfg["counterReset"] }))} options={[
                { value: "never", label: "Never" }, { value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" },
              ]} />
            </Field>
            <Field label="Max guests per table"><Input type="number" value={s.maxGuestsPerTable} onChange={e => set(p => ({ ...p, maxGuestsPerTable: Number(e.target.value) }))} /></Field>
          </Row>
          <Toggle label="Hold-and-fire mode" hint="Items wait until staff fires them, instead of going straight to KDS." checked={s.holdAndFire} onChange={v => set(p => ({ ...p, holdAndFire: v }))} />
          <Toggle label="Course-by-course service" hint="Group items into courses (Starter / Main / Dessert) and fire one at a time." checked={s.courseService} onChange={v => set(p => ({ ...p, courseService: v }))} />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 25. Refund Reasons ---------------- */
function RefundReasonsSection() {
  const defaults: ReasonsCfg = { reasons: [
    { id: "quality", label: "Quality issue", isActive: true },
    { id: "wrong-charge", label: "Wrong charge", isActive: true },
    { id: "comped", label: "Comped by manager", isActive: true },
    { id: "other-r", label: "Other", isActive: true },
  ]};
  return (
    <SettingForm section="refund-reasons" defaults={defaults}
      description="Reasons available when issuing a refund.">
      {(s, set) => (
        <ListEditor
          items={s.reasons}
          onChange={items => set(p => ({ ...p, reasons: items }))}
          addLabel="Add reason"
          makeNew={() => ({ id: `r-${Date.now()}`, label: "", isActive: true })}
          render={(item, _i, update, remove) => (
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={item.label} onChange={e => update({ label: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={item.isActive} onChange={e => update({ isActive: e.target.checked })} /> Active</label>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        />
      )}
    </SettingForm>
  );
}

/* ---------------- 25b. Direct Online Ordering (Task #432) ---------------- */
interface DirectOrderingCfg {
  orderingEnabled: boolean;
  allowPickup: boolean;
  allowDelivery: boolean;
  allowScheduling: boolean;
  minOrderValue: number;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  deliveryRadiusKm: number;
  schemaEnabled: boolean;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
  cuisine: string;
  priceRange: string;
  customOrderingLink: string;
  holidayClosures: string[]; // YYYY-MM-DD list
}
function DirectOrderingSection() {
  const { data: restaurant } = useRestaurantInfo();
  const defaults: DirectOrderingCfg = {
    orderingEnabled: true,
    allowPickup: true, allowDelivery: false, allowScheduling: true,
    minOrderValue: 0, deliveryFee: 0, freeDeliveryThreshold: 0, deliveryRadiusKm: 5,
    schemaEnabled: true,
    seoTitle: "", seoDescription: "", ogImageUrl: "",
    cuisine: "", priceRange: "$$",
    customOrderingLink: "",
    holidayClosures: [],
  };
  const slug = restaurant?.slug ?? "";
  const base = import.meta.env.BASE_URL || "/";
  const orderingUrl = slug ? `${window.location.origin}${base}menu/${slug}` : "";
  const sitemapUrl = `${window.location.origin}/api/public/sitemap.xml`;
  return (
    <SettingForm section="direct-ordering" defaults={defaults}
      description="SEO-friendly direct online ordering page (pickup & delivery). Lives at /menu/<slug>. Settings here power meta tags, schema.org markup, holiday closures, and delivery rules.">
      {(s, set) => (
        <>
          <Toggle label="Direct online ordering enabled" hint="When off, customers see a friendly 'ordering closed' message and cannot place orders." checked={s.orderingEnabled} onChange={v => set(p => ({ ...p, orderingEnabled: v }))} />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Ordering link</p>
          <div className="space-y-2">
            {slug ? (
              <div className="flex items-center gap-2">
                <Input value={orderingUrl} readOnly className="font-mono text-xs" />
                <Button type="button" size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(orderingUrl); }}>Copy</Button>
                <a href={orderingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Open <ExternalLink className="w-3 h-3" /></a>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Set a restaurant slug under Restaurant Profile to enable a public ordering URL.</p>
            )}
            <Field label="Custom ordering link (optional)" hint="If you have a shorter vanity URL (e.g. order.yourdomain.com) paste it here. Shown to staff to share with guests.">
              <Input value={s.customOrderingLink} placeholder="https://order.example.com" onChange={e => set(p => ({ ...p, customOrderingLink: e.target.value }))} />
            </Field>
            <div className="text-xs text-muted-foreground">
              Search-engine sitemap: <a href={sitemapUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{sitemapUrl}</a> — submit this to Google Search Console.
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Order modes</p>
          <Toggle label="Allow pickup" checked={s.allowPickup} onChange={v => set(p => ({ ...p, allowPickup: v }))} />
          <Toggle label="Allow delivery" checked={s.allowDelivery} onChange={v => set(p => ({ ...p, allowDelivery: v }))} />
          <Toggle label="Allow customers to schedule for later" checked={s.allowScheduling} onChange={v => set(p => ({ ...p, allowScheduling: v }))} />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Order rules</p>
          <Row>
            <Field label="Minimum order value" hint="Cart subtotal must reach this amount before checkout."><Input type="number" value={s.minOrderValue} onChange={e => set(p => ({ ...p, minOrderValue: Number(e.target.value) }))} /></Field>
            <Field label="Delivery radius (km)" hint="Display only — used in schema and on the customer page."><Input type="number" value={s.deliveryRadiusKm} onChange={e => set(p => ({ ...p, deliveryRadiusKm: Number(e.target.value) }))} /></Field>
          </Row>
          <Row>
            <Field label="Flat delivery fee"><Input type="number" value={s.deliveryFee} onChange={e => set(p => ({ ...p, deliveryFee: Number(e.target.value) }))} /></Field>
            <Field label="Free delivery above" hint="Subtotal at or above this waives the delivery fee. 0 = never free."><Input type="number" value={s.freeDeliveryThreshold} onChange={e => set(p => ({ ...p, freeDeliveryThreshold: Number(e.target.value) }))} /></Field>
          </Row>

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">Holiday closures</p>
          <p className="text-xs text-muted-foreground -mt-2">Dates listed here block new online orders for the entire day. Format YYYY-MM-DD.</p>
          <ListEditor
            items={s.holidayClosures.map((d, i) => ({ id: `c-${i}`, date: d }))}
            onChange={items => set(p => ({ ...p, holidayClosures: items.map(i => i.date).filter(Boolean) }))}
            addLabel="Add closed date"
            makeNew={() => ({ id: `c-${Date.now()}`, date: new Date().toISOString().slice(0, 10) })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input type="date" className="w-48" value={item.date} onChange={e => update({ date: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />

          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3">SEO & schema</p>
          <Toggle label="Inject schema.org Restaurant + Menu JSON-LD" hint="Helps Google show your menu in rich results." checked={s.schemaEnabled} onChange={v => set(p => ({ ...p, schemaEnabled: v }))} />
          <Field label="Page title (≤60 chars)"><Input maxLength={70} value={s.seoTitle} placeholder={`Order ${restaurant?.name ?? "your restaurant"} Online – Pickup & Delivery`} onChange={e => set(p => ({ ...p, seoTitle: e.target.value }))} /></Field>
          <Field label="Meta description (≤160 chars)"><Textarea rows={2} maxLength={200} value={s.seoDescription} placeholder="Order online for pickup or delivery. Skip the line." onChange={e => set(p => ({ ...p, seoDescription: e.target.value }))} /></Field>
          <Field label="Social share image (Open Graph)"><ImageUploadField value={s.ogImageUrl} onChange={url => set(p => ({ ...p, ogImageUrl: url ?? "" }))} /></Field>
          <Row>
            <Field label="Cuisine" hint="Used in schema.org servesCuisine (e.g. Italian, Indian)."><Input value={s.cuisine} onChange={e => set(p => ({ ...p, cuisine: e.target.value }))} /></Field>
            <Field label="Price range" hint="Used in schema.org (e.g. $, $$, $$$).">
              <Select value={s.priceRange} onChange={v => set(p => ({ ...p, priceRange: v }))} options={[
                { value: "$", label: "$" }, { value: "$$", label: "$$" }, { value: "$$$", label: "$$$" }, { value: "$$$$", label: "$$$$" },
              ]} />
            </Field>
          </Row>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 26. AI ---------------- */
interface AiCfg {
  menuSuggestions: boolean; demandForecasting: boolean; staffSchedulingAssistant: boolean;
  modelPreference: "auto" | "gpt-4" | "claude" | "gemini";
  optInTraining: boolean;
}
function AiSection() {
  const defaults: AiCfg = {
    menuSuggestions: false, demandForecasting: false, staffSchedulingAssistant: false,
    modelPreference: "auto", optInTraining: false,
  };
  const { data: restaurant } = useRestaurantInfo();
  const updateRestaurant = useUpdateRestaurant();
  const voiceEnabled = !!restaurant?.enableVoiceOrdering;
  return (
    <SettingForm section="ai" defaults={defaults}
      description="AI-powered features. All inference uses the platform's managed AI integrations — no API keys to configure here.">
      {(s, set) => (
        <>
          <Toggle
            label="AI Voice Order Assistant"
            hint="Show a push-to-talk mic in POS and the waiter app. Hindi/English/Hinglish speech is parsed into a confirmation modal — orders are only created after the user confirms. Charged 1 credit per parse."
            checked={voiceEnabled}
            onChange={(v) => updateRestaurant.mutate({ enableVoiceOrdering: v })}
          />
          <Toggle label="AI menu suggestions" hint="Suggest combos, upsells, and seasonal items in POS." checked={s.menuSuggestions} onChange={v => set(p => ({ ...p, menuSuggestions: v }))} />
          <Toggle label="AI demand forecasting" hint="Predict tomorrow's covers and ingredient needs." checked={s.demandForecasting} onChange={v => set(p => ({ ...p, demandForecasting: v }))} />
          <Toggle label="AI staff scheduling assistant" hint="Recommend shifts based on historical demand." checked={s.staffSchedulingAssistant} onChange={v => set(p => ({ ...p, staffSchedulingAssistant: v }))} />
          <Field label="Model preference">
            <Select value={s.modelPreference} onChange={v => set(p => ({ ...p, modelPreference: v as AiCfg["modelPreference"] }))} options={[
              { value: "auto", label: "Auto (best available)" }, { value: "gpt-4", label: "OpenAI GPT-4" }, { value: "claude", label: "Anthropic Claude" }, { value: "gemini", label: "Google Gemini" },
            ]} />
          </Field>
          <Toggle label="Opt in to anonymous training data" hint="Help improve the underlying models. Order content is anonymized." checked={s.optInTraining} onChange={v => set(p => ({ ...p, optInTraining: v }))} />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 27. Kiosk ---------------- */
interface KioskCfg {
  enabled: boolean; idleTimeoutSec: number; attractLoopSec: number;
  allowedPaymentMethods: string[]; languagePicker: boolean; accessibilityTextSize: "default" | "large" | "xlarge";
}
function KioskSection() {
  const defaults: KioskCfg = {
    enabled: false, idleTimeoutSec: 60, attractLoopSec: 15,
    allowedPaymentMethods: ["card", "upi"], languagePicker: true, accessibilityTextSize: "default",
  };
  return (
    <SettingForm section="kiosk" defaults={defaults}>
      {(s, set) => (
        <>
          <Toggle label="Kiosk mode enabled" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <Row>
            <Field label="Idle timeout (sec)" hint="Reset to home if no input for this long."><Input type="number" value={s.idleTimeoutSec} onChange={e => set(p => ({ ...p, idleTimeoutSec: Number(e.target.value) }))} /></Field>
            <Field label="Attract-loop interval (sec)"><Input type="number" value={s.attractLoopSec} onChange={e => set(p => ({ ...p, attractLoopSec: Number(e.target.value) }))} /></Field>
          </Row>
          <Field label="Allowed payment methods">
            <div className="flex flex-wrap gap-2">
              {["cash", "card", "upi", "wallet", "online"].map(m => (
                <label key={m} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg cursor-pointer text-sm">
                  <input type="checkbox" checked={s.allowedPaymentMethods.includes(m)}
                    onChange={e => set(p => ({ ...p, allowedPaymentMethods: e.target.checked ? [...p.allowedPaymentMethods, m] : p.allowedPaymentMethods.filter(x => x !== m) }))} />
                  {m}
                </label>
              ))}
            </div>
          </Field>
          <Toggle label="Language picker" checked={s.languagePicker} onChange={v => set(p => ({ ...p, languagePicker: v }))} />
          <Field label="Accessibility text size">
            <Select value={s.accessibilityTextSize} onChange={v => set(p => ({ ...p, accessibilityTextSize: v as KioskCfg["accessibilityTextSize"] }))} options={[
              { value: "default", label: "Default" }, { value: "large", label: "Large" }, { value: "xlarge", label: "Extra large" },
            ]} />
          </Field>
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 29. Discounts & Coupons ----------------
 * Backend hashes `managerPin` server-side into `managerPinHash` and never
 * returns the hash to the client. The GET response surfaces only
 * `hasManagerPin` so the UI knows whether to show "Set" vs "Change".
 * Submitting an empty PIN string clears the configured PIN.
 */
interface DiscountsSettingsCfg {
  presetReasons: string[];
  thresholdPercent: number;
  thresholdAmount: number;
  hasManagerPin?: boolean;
  managerPin?: string;
  otpEnabled?: boolean;
  roleCaps?: {
    cashier?: { percent: number; amount: number };
    waiter?:  { percent: number; amount: number };
    manager?: { percent: number; amount: number };
  };
  suspicious?: {
    perBillPercent: number;
    perShiftAmount: number;
    perCustomerMaxVisits: number;
    perCustomerVisitDiscountPct: number;
  };
}
function DiscountsSection() {
  const defaults: DiscountsSettingsCfg = {
    presetReasons: [
      "Loyal customer", "Comp item", "Manager override",
      "Damaged / quality issue", "Promo / marketing", "Staff meal",
    ],
    thresholdPercent: 15,
    thresholdAmount: 500,
    hasManagerPin: false,
    otpEnabled: false,
    roleCaps: {
      cashier: { percent: 10, amount: 200 },
      waiter:  { percent: 10, amount: 200 },
      manager: { percent: 30, amount: 1000 },
    },
    suspicious: {
      perBillPercent: 50,
      perShiftAmount: 5000,
      perCustomerMaxVisits: 5,
      perCustomerVisitDiscountPct: 30,
    },
  };
  return (
    <SettingForm section="discounts" defaults={defaults}
      description="Cashier-facing discount reasons and the threshold above which a manager PIN is required to approve a discount.">
      {(s, set) => (
        <>
          <Row>
            <Field label="Manager-PIN threshold (%)" hint="When the order's cumulative discount reaches this percentage of subtotal, manager PIN is required.">
              <Input type="number" min="0" max="100" step="1" value={s.thresholdPercent}
                onChange={e => set(p => ({ ...p, thresholdPercent: Number(e.target.value) }))} />
            </Field>
            <Field label="Manager-PIN threshold (₹)" hint="When the order's cumulative discount reaches this rupee amount, manager PIN is required.">
              <Input type="number" min="0" step="1" value={s.thresholdAmount}
                onChange={e => set(p => ({ ...p, thresholdAmount: Number(e.target.value) }))} />
            </Field>
          </Row>
          <Toggle label="Allow manager OTP approval (SMS)"
            checked={!!s.otpEnabled}
            onChange={v => set(p => ({ ...p, otpEnabled: v }))} />
          <p className="text-xs text-muted-foreground -mt-2">
            When enabled, cashiers can request a 6-digit OTP sent to a manager's phone to approve high-value discounts (alongside or instead of the PIN).
          </p>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Per-role discount caps</p>
          <p className="text-xs text-muted-foreground -mt-2">A discount that exceeds either the % or the ₹ cap for the requesting user's role triggers manager approval. Set 0 = unlimited. Owners always bypass.</p>
          {(["cashier", "waiter", "manager"] as const).map(role => {
            const cap = s.roleCaps?.[role] ?? { percent: 0, amount: 0 };
            return (
              <Row key={role}>
                <Field label={`${role.charAt(0).toUpperCase() + role.slice(1)} cap (%)`}>
                  <Input type="number" min="0" max="100" step="1" value={cap.percent}
                    onChange={e => set(p => ({ ...p, roleCaps: { ...(p.roleCaps ?? {}), [role]: { ...cap, percent: Number(e.target.value) } } }))} />
                </Field>
                <Field label={`${role.charAt(0).toUpperCase() + role.slice(1)} cap (₹)`}>
                  <Input type="number" min="0" step="1" value={cap.amount}
                    onChange={e => set(p => ({ ...p, roleCaps: { ...(p.roleCaps ?? {}), [role]: { ...cap, amount: Number(e.target.value) } } }))} />
                </Field>
              </Row>
            );
          })}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Suspicious-discount detector</p>
          <p className="text-xs text-muted-foreground -mt-2">Tunes when the fraud engine flags discounts as suspicious.</p>
          <Row>
            <Field label="Per-bill % threshold" hint="Single bill discounted by more than this % is flagged.">
              <Input type="number" min="0" max="100" step="1" value={s.suspicious?.perBillPercent ?? 50}
                onChange={e => set(p => ({ ...p, suspicious: { ...(p.suspicious ?? defaults.suspicious!), perBillPercent: Number(e.target.value) } }))} />
            </Field>
            <Field label="Per-shift cashier ₹ cap" hint="Cumulative discount per cashier per shift before flagging.">
              <Input type="number" min="0" step="1" value={s.suspicious?.perShiftAmount ?? 5000}
                onChange={e => set(p => ({ ...p, suspicious: { ...(p.suspicious ?? defaults.suspicious!), perShiftAmount: Number(e.target.value) } }))} />
            </Field>
          </Row>
          <Row>
            <Field label="Per-customer max discounted visits" hint="If one phone number receives this many discounted visits in window, flag.">
              <Input type="number" min="1" step="1" value={s.suspicious?.perCustomerMaxVisits ?? 5}
                onChange={e => set(p => ({ ...p, suspicious: { ...(p.suspicious ?? defaults.suspicious!), perCustomerMaxVisits: Number(e.target.value) } }))} />
            </Field>
            <Field label="Min % to count toward visits" hint="Visits with discount below this % don't count.">
              <Input type="number" min="0" max="100" step="1" value={s.suspicious?.perCustomerVisitDiscountPct ?? 30}
                onChange={e => set(p => ({ ...p, suspicious: { ...(p.suspicious ?? defaults.suspicious!), perCustomerVisitDiscountPct: Number(e.target.value) } }))} />
            </Field>
          </Row>
          <Field label={s.hasManagerPin ? "Change manager PIN" : "Set manager PIN"}
            hint="4–8 digits. Stored hashed. Leave blank to keep the existing PIN.">
            <div className="flex items-center gap-2">
              <Input type="password" inputMode="numeric" autoComplete="new-password" className="flex-1"
                placeholder={s.hasManagerPin ? "•••• (set — type to change)" : "Enter new PIN"}
                value={s.managerPin ?? ""}
                onChange={e => set(p => {
                  const v = e.target.value;
                  const next = { ...p };
                  if (v.length === 0) delete next.managerPin;
                  else next.managerPin = v;
                  return next;
                })} />
              {s.hasManagerPin && (
                <Button type="button" variant="outline" size="sm"
                  onClick={() => set(p => ({ ...p, managerPin: "" }))}>
                  Clear PIN
                </Button>
              )}
            </div>
          </Field>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Preset reasons</p>
          <ListEditor
            items={s.presetReasons.map((label, i) => ({ id: `r-${i}`, label }))}
            onChange={items => set(p => ({ ...p, presetReasons: items.map(i => i.label).filter(l => l.trim().length > 0) }))}
            addLabel="Add reason"
            makeNew={() => ({ id: `r-${Date.now()}`, label: "" })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Reason label" value={item.label}
                  onChange={e => update({ label: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 28. Loyalty Program 2.0 (12 mechanics, tabbed) ---------------- */
const LOYALTY2_TABS = [
  "Core", "Tiers", "Stamps", "Cashback", "Referrals",
  "Mystery", "Streaks", "Milestones", "Birthday", "Double Points",
  "Item Rules", "Family",
] as const;
type Loyalty2Tab = typeof LOYALTY2_TABS[number];

// Mirrors api-server's Loyalty2Config — kept loosely typed in the UI for brevity.
interface Loyalty2Cfg {
  enabled: boolean;
  pointsPerCurrencyUnit: number; redemptionRate: number;
  signupBonus: number; expiryMonths: number;
  tiers: { id: string; name: string; threshold: number; multiplier: number; perks?: string[] }[];
  tierRules: { basis: "lifetime_points" | "lifetime_spend" | "rolling_visits"; windowDays: number; graceDays: number };
  stampCards: { id: string; name: string; required: number; rewardType: "free_item" | "coupon" | "points"; rewardValue: number | string; rewardLabel?: string }[];
  cashback: { enabled: boolean; percent: number; minOrderAmount: number; maxRedeemPercent: number; minRedeemAmount: number; expiryDays: number };
  referral: { enabled: boolean; rewardType: "points" | "cashback" | "coupon"; referrerReward: number; refereeReward: number; minFirstOrder: number };
  mystery: { enabled: boolean; triggerKind: "order_count" | "order_chance" | "scratch"; triggerValue: number; pool: { key: string; label: string; weight: number; rewardType: "points"|"cashback"|"coupon"|"free_item"; rewardValue: number | string }[] };
  streak: { enabled: boolean; windowKind: "day" | "week"; targetStreak: number; rewardType: "points"|"cashback"|"coupon"; rewardValue: number | string };
  milestones: { enabled: boolean; windowDays: number; tiers: { key: string; threshold: number; rewardType: "points"|"cashback"|"coupon"; rewardValue: number | string }[] };
  birthday: { enabled: boolean; windowDays: number; rewardType: "points"|"cashback"|"coupon"; rewardValue: number | string; notify: boolean };
  doublePoints: { enabled: boolean; rules: { id: string; label: string; multiplier: number; daysOfWeek?: number[]; startHour?: number; endHour?: number }[] };
  itemRules: { enabled: boolean; rules: { id: string; scope: "item"|"category"; refId: number; multiplier?: number; bonusPoints?: number; earnsStampCardId?: string }[] };
  family: { enabled: boolean; maxMembers: number; shareCashback: boolean; sharePoints: boolean };
  featureFlags: Partial<Record<string, boolean>>;
}

const LOYALTY2_DEFAULTS: Loyalty2Cfg = {
  enabled: false,
  pointsPerCurrencyUnit: 1, redemptionRate: 0.05,
  signupBonus: 0, expiryMonths: 0,
  tiers: [
    { id: "bronze", name: "Bronze", threshold: 0, multiplier: 1, perks: [] },
    { id: "silver", name: "Silver", threshold: 1000, multiplier: 1.25, perks: ["Priority support"] },
    { id: "gold", name: "Gold", threshold: 5000, multiplier: 1.5, perks: ["Free delivery", "Birthday surprise"] },
  ],
  tierRules: { basis: "lifetime_points", windowDays: 365, graceDays: 30 },
  stampCards: [],
  cashback: { enabled: false, percent: 0, minOrderAmount: 0, maxRedeemPercent: 50, minRedeemAmount: 0, expiryDays: 90 },
  referral: { enabled: false, rewardType: "points", referrerReward: 200, refereeReward: 100, minFirstOrder: 0 },
  mystery: { enabled: false, triggerKind: "order_count", triggerValue: 5, pool: [] },
  streak: { enabled: false, windowKind: "day", targetStreak: 5, rewardType: "points", rewardValue: 100 },
  milestones: { enabled: false, windowDays: 0, tiers: [] },
  birthday: { enabled: false, windowDays: 7, rewardType: "points", rewardValue: 100, notify: true },
  doublePoints: { enabled: false, rules: [] },
  itemRules: { enabled: false, rules: [] },
  family: { enabled: false, maxMembers: 5, shareCashback: true, sharePoints: true },
  featureFlags: {},
};

function LoyaltySection() {
  const [tab, setTab] = useState<Loyalty2Tab>("Core");
  return (
    <SettingForm section="loyalty" defaults={LOYALTY2_DEFAULTS}>
      {(s, set) => (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
            {LOYALTY2_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${tab === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-accent"}`}>
                {t}
              </button>
            ))}
          </div>
          {tab === "Core" && <LoyaltyCoreTab s={s} set={set} />}
          {tab === "Tiers" && <LoyaltyTiersTab s={s} set={set} />}
          {tab === "Stamps" && <LoyaltyStampsTab s={s} set={set} />}
          {tab === "Cashback" && <LoyaltyCashbackTab s={s} set={set} />}
          {tab === "Referrals" && <LoyaltyReferralsTab s={s} set={set} />}
          {tab === "Mystery" && <LoyaltyMysteryTab s={s} set={set} />}
          {tab === "Streaks" && <LoyaltyStreaksTab s={s} set={set} />}
          {tab === "Milestones" && <LoyaltyMilestonesTab s={s} set={set} />}
          {tab === "Birthday" && <LoyaltyBirthdayTab s={s} set={set} />}
          {tab === "Double Points" && <LoyaltyDoublePointsTab s={s} set={set} />}
          {tab === "Item Rules" && <LoyaltyItemRulesTab s={s} set={set} />}
          {tab === "Family" && <LoyaltyFamilyTab s={s} set={set} />}
        </>
      )}
    </SettingForm>
  );
}

type Setter = (updater: (p: Loyalty2Cfg) => Loyalty2Cfg) => void;
function flagToggle(s: Loyalty2Cfg, set: Setter, key: string, label: string) {
  return (
    <Toggle label={label} checked={s.featureFlags[key] !== false}
      hint="Per-mechanic feature flag — turn off here without losing config."
      onChange={v => set(p => ({ ...p, featureFlags: { ...p.featureFlags, [key]: v } }))} />
  );
}

function LoyaltyCoreTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  return (
    <>
      <Toggle label="Loyalty program enabled (master switch — defaults OFF for existing tenants)"
        checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
      <Row>
        <Field label="Points per currency unit" hint="₹1 spent earns this many points (before tier/double-points multipliers).">
          <Input type="number" step="0.1" value={s.pointsPerCurrencyUnit}
            onChange={e => set(p => ({ ...p, pointsPerCurrencyUnit: Number(e.target.value) }))} />
        </Field>
        <Field label="Redemption rate" hint="Currency value per point (e.g. 0.05 = ₹0.05 per point).">
          <Input type="number" step="0.01" value={s.redemptionRate}
            onChange={e => set(p => ({ ...p, redemptionRate: Number(e.target.value) }))} />
        </Field>
      </Row>
      <Row>
        <Field label="Sign-up bonus (points)">
          <Input type="number" value={s.signupBonus}
            onChange={e => set(p => ({ ...p, signupBonus: Number(e.target.value) }))} />
        </Field>
        <Field label="Points expiry (months)" hint="0 = never expires.">
          <Input type="number" value={s.expiryMonths}
            onChange={e => set(p => ({ ...p, expiryMonths: Number(e.target.value) }))} />
        </Field>
      </Row>
    </>
  );
}

function LoyaltyTiersTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  return (
    <>
      {flagToggle(s, set, "tiers", "Tiers enabled")}
      <Row>
        <Field label="Tier basis">
          <Select value={s.tierRules.basis}
            onChange={v => set(p => ({ ...p, tierRules: { ...p.tierRules, basis: v } }))}
            options={[
              { value: "lifetime_points", label: "Lifetime points" },
              { value: "lifetime_spend",  label: "Lifetime spend" },
              { value: "rolling_visits",  label: "Rolling visits" },
            ]} />
        </Field>
        <Field label="Rolling window (days)" hint="Used for spend/visits bases. 0 = lifetime.">
          <Input type="number" value={s.tierRules.windowDays}
            onChange={e => set(p => ({ ...p, tierRules: { ...p.tierRules, windowDays: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <Field label="Grace period (days)" hint="Tier downgrade is delayed by this many days after threshold lapses.">
        <Input type="number" value={s.tierRules.graceDays}
          onChange={e => set(p => ({ ...p, tierRules: { ...p.tierRules, graceDays: Number(e.target.value) } }))} />
      </Field>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Tier ladder</p>
      <ListEditor items={s.tiers}
        onChange={items => set(p => ({ ...p, tiers: items }))}
        addLabel="Add tier"
        makeNew={() => ({ id: `tier-${Date.now()}`, name: "", threshold: 0, multiplier: 1, perks: [] })}
        render={(item, _i, update, remove) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Tier name" value={item.name} onChange={e => update({ name: e.target.value })} />
              <span className="text-xs text-muted-foreground">at</span>
              <Input className="w-28" type="number" placeholder="Threshold" value={item.threshold} onChange={e => update({ threshold: Number(e.target.value) })} />
              <Input className="w-24" type="number" step="0.05" value={item.multiplier} onChange={e => update({ multiplier: Number(e.target.value) })} />
              <span className="text-xs text-muted-foreground">×</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            <Input placeholder="Perks (comma-separated)" value={(item.perks ?? []).join(", ")}
              onChange={e => update({ perks: e.target.value.split(",").map(p => p.trim()).filter(Boolean) })} />
          </div>
        )} />
    </>
  );
}

function LoyaltyStampsTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  return (
    <>
      {flagToggle(s, set, "stamps", "Punch / stamp cards enabled")}
      <ListEditor items={s.stampCards}
        onChange={cards => set(p => ({ ...p, stampCards: cards }))}
        addLabel="Add stamp card"
        makeNew={() => ({ id: `card-${Date.now()}`, name: "Buy 5, get 1 free", required: 5, rewardType: "free_item" as const, rewardValue: "", rewardLabel: "" })}
        render={(item, _i, update, remove) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Card name" value={item.name} onChange={e => update({ name: e.target.value })} />
              <Input className="w-20" type="number" placeholder="Stamps" value={item.required} onChange={e => update({ required: Number(e.target.value) })} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={item.rewardType}
                onChange={v => update({ rewardType: v })}
                options={[{ value: "free_item", label: "Free item" }, { value: "coupon", label: "Coupon" }, { value: "points", label: "Points" }]} />
              <Input className="flex-1" placeholder="Reward value (item name, coupon code, or points)" value={String(item.rewardValue)} onChange={e => update({ rewardValue: e.target.value })} />
            </div>
          </div>
        )} />
    </>
  );
}

function LoyaltyCashbackTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const c = s.cashback;
  return (
    <>
      <Toggle label="Cashback wallet enabled" checked={c.enabled}
        onChange={v => set(p => ({ ...p, cashback: { ...p.cashback, enabled: v } }))} />
      <Row>
        <Field label="Earn %" hint="Percent of subtotal credited as cashback.">
          <Input type="number" step="0.5" value={c.percent} onChange={e => set(p => ({ ...p, cashback: { ...p.cashback, percent: Number(e.target.value) } }))} />
        </Field>
        <Field label="Min order to earn (₹)">
          <Input type="number" value={c.minOrderAmount} onChange={e => set(p => ({ ...p, cashback: { ...p.cashback, minOrderAmount: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <Row>
        <Field label="Max redeem %" hint="Cap on how much of an order can be paid via cashback.">
          <Input type="number" value={c.maxRedeemPercent} onChange={e => set(p => ({ ...p, cashback: { ...p.cashback, maxRedeemPercent: Number(e.target.value) } }))} />
        </Field>
        <Field label="Min wallet balance to redeem (₹)">
          <Input type="number" value={c.minRedeemAmount} onChange={e => set(p => ({ ...p, cashback: { ...p.cashback, minRedeemAmount: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <Field label="Cashback expiry (days)" hint="0 = never">
        <Input type="number" value={c.expiryDays} onChange={e => set(p => ({ ...p, cashback: { ...p.cashback, expiryDays: Number(e.target.value) } }))} />
      </Field>
    </>
  );
}

function LoyaltyReferralsTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const r = s.referral;
  return (
    <>
      <Toggle label="Referrals enabled" checked={r.enabled}
        onChange={v => set(p => ({ ...p, referral: { ...p.referral, enabled: v } }))} />
      <Row>
        <Field label="Reward type">
          <Select value={r.rewardType} onChange={v => set(p => ({ ...p, referral: { ...p.referral, rewardType: v } }))}
            options={[{ value: "points", label: "Points" }, { value: "cashback", label: "Cashback" }, { value: "coupon", label: "Coupon" }]} />
        </Field>
        <Field label="Min first order (₹)" hint="Referee must spend at least this for the referral to convert.">
          <Input type="number" value={r.minFirstOrder} onChange={e => set(p => ({ ...p, referral: { ...p.referral, minFirstOrder: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <Row>
        <Field label="Referrer reward"><Input type="number" value={r.referrerReward} onChange={e => set(p => ({ ...p, referral: { ...p.referral, referrerReward: Number(e.target.value) } }))} /></Field>
        <Field label="Referee reward"><Input type="number" value={r.refereeReward} onChange={e => set(p => ({ ...p, referral: { ...p.referral, refereeReward: Number(e.target.value) } }))} /></Field>
      </Row>
    </>
  );
}

function LoyaltyMysteryTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const m = s.mystery;
  return (
    <>
      <Toggle label="Mystery rewards enabled" checked={m.enabled}
        onChange={v => set(p => ({ ...p, mystery: { ...p.mystery, enabled: v } }))} />
      <Row>
        <Field label="Trigger">
          <Select value={m.triggerKind} onChange={v => set(p => ({ ...p, mystery: { ...p.mystery, triggerKind: v } }))}
            options={[
              { value: "order_count",  label: "Every Nth order" },
              { value: "order_chance", label: "Chance per order (%)" },
              { value: "scratch",      label: "Always grant a scratch card" },
            ]} />
        </Field>
        <Field label={m.triggerKind === "order_chance" ? "Chance %" : "N (orders)"}>
          <Input type="number" value={m.triggerValue} onChange={e => set(p => ({ ...p, mystery: { ...p.mystery, triggerValue: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Reward pool (weighted)</p>
      <ListEditor items={m.pool}
        onChange={pool => set(p => ({ ...p, mystery: { ...p.mystery, pool } }))}
        addLabel="Add reward"
        makeNew={() => ({ key: `r-${Date.now()}`, label: "", weight: 1, rewardType: "points" as const, rewardValue: 50 })}
        render={(item, _i, update, remove) => (
          <div className="flex items-center gap-2">
            <Input className="flex-1" placeholder="Label" value={item.label} onChange={e => update({ label: e.target.value })} />
            <Input className="w-20" type="number" placeholder="Weight" value={item.weight} onChange={e => update({ weight: Number(e.target.value) })} />
            <Select value={item.rewardType} onChange={v => update({ rewardType: v })}
              options={[{ value: "points", label: "Points" }, { value: "cashback", label: "Cashback" }, { value: "coupon", label: "Coupon" }, { value: "free_item", label: "Free item" }]} />
            <Input className="w-32" placeholder="Value" value={String(item.rewardValue)} onChange={e => update({ rewardValue: e.target.value })} />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        )} />
    </>
  );
}

function LoyaltyStreaksTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const st = s.streak;
  return (
    <>
      <Toggle label="Visit streaks enabled" checked={st.enabled}
        onChange={v => set(p => ({ ...p, streak: { ...p.streak, enabled: v } }))} />
      <Row>
        <Field label="Window">
          <Select value={st.windowKind} onChange={v => set(p => ({ ...p, streak: { ...p.streak, windowKind: v } }))}
            options={[{ value: "day", label: "Daily streak" }, { value: "week", label: "Weekly streak" }]} />
        </Field>
        <Field label="Target streak length">
          <Input type="number" value={st.targetStreak} onChange={e => set(p => ({ ...p, streak: { ...p.streak, targetStreak: Number(e.target.value) } }))} />
        </Field>
      </Row>
      <Row>
        <Field label="Reward type">
          <Select value={st.rewardType} onChange={v => set(p => ({ ...p, streak: { ...p.streak, rewardType: v } }))}
            options={[{ value: "points", label: "Points" }, { value: "cashback", label: "Cashback" }, { value: "coupon", label: "Coupon" }]} />
        </Field>
        <Field label="Reward value">
          <Input value={String(st.rewardValue)} onChange={e => set(p => ({ ...p, streak: { ...p.streak, rewardValue: e.target.value } }))} />
        </Field>
      </Row>
    </>
  );
}

function LoyaltyMilestonesTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const m = s.milestones;
  return (
    <>
      <Toggle label="Spend milestones enabled" checked={m.enabled}
        onChange={v => set(p => ({ ...p, milestones: { ...p.milestones, enabled: v } }))} />
      <Field label="Window (days)" hint="0 = lifetime">
        <Input type="number" value={m.windowDays} onChange={e => set(p => ({ ...p, milestones: { ...p.milestones, windowDays: Number(e.target.value) } }))} />
      </Field>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Milestone tiers</p>
      <ListEditor items={m.tiers}
        onChange={tiers => set(p => ({ ...p, milestones: { ...p.milestones, tiers } }))}
        addLabel="Add milestone"
        makeNew={() => ({ key: `ms-${Date.now()}`, threshold: 1000, rewardType: "points" as const, rewardValue: 100 })}
        render={(item, _i, update, remove) => (
          <div className="flex items-center gap-2">
            <Input className="w-32" placeholder="Key" value={item.key} onChange={e => update({ key: e.target.value })} />
            <Input className="w-32" type="number" placeholder="Spend ≥ ₹" value={item.threshold} onChange={e => update({ threshold: Number(e.target.value) })} />
            <Select value={item.rewardType} onChange={v => update({ rewardType: v })}
              options={[{ value: "points", label: "Points" }, { value: "cashback", label: "Cashback" }, { value: "coupon", label: "Coupon" }]} />
            <Input className="w-32" placeholder="Value" value={String(item.rewardValue)} onChange={e => update({ rewardValue: e.target.value })} />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        )} />
    </>
  );
}

function LoyaltyBirthdayTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const b = s.birthday;
  return (
    <>
      <Toggle label="Birthday rewards enabled" checked={b.enabled}
        onChange={v => set(p => ({ ...p, birthday: { ...p.birthday, enabled: v } }))} />
      <Row>
        <Field label="Window (days around birthday)">
          <Input type="number" value={b.windowDays} onChange={e => set(p => ({ ...p, birthday: { ...p.birthday, windowDays: Number(e.target.value) } }))} />
        </Field>
        <Field label="Reward type">
          <Select value={b.rewardType} onChange={v => set(p => ({ ...p, birthday: { ...p.birthday, rewardType: v } }))}
            options={[{ value: "points", label: "Points" }, { value: "cashback", label: "Cashback" }, { value: "coupon", label: "Coupon" }]} />
        </Field>
      </Row>
      <Row>
        <Field label="Reward value"><Input value={String(b.rewardValue)} onChange={e => set(p => ({ ...p, birthday: { ...p.birthday, rewardValue: e.target.value } }))} /></Field>
        <Field label="Notify customer (in-app)">
          <Toggle label="Send notification" checked={b.notify} onChange={v => set(p => ({ ...p, birthday: { ...p.birthday, notify: v } }))} />
        </Field>
      </Row>
    </>
  );
}

function LoyaltyDoublePointsTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  return (
    <>
      <Toggle label="Double-points days/dayparts enabled" checked={s.doublePoints.enabled}
        onChange={v => set(p => ({ ...p, doublePoints: { ...p.doublePoints, enabled: v } }))} />
      <ListEditor items={s.doublePoints.rules}
        onChange={rules => set(p => ({ ...p, doublePoints: { ...p.doublePoints, rules } }))}
        addLabel="Add rule"
        makeNew={() => ({ id: `dp-${Date.now()}`, label: "Happy hours", multiplier: 2, daysOfWeek: [], startHour: 0, endHour: 24 })}
        render={(item, _i, update, remove) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Label (e.g. Mon Madness)" value={item.label} onChange={e => update({ label: e.target.value })} />
              <Input className="w-20" type="number" step="0.5" placeholder="× mult" value={item.multiplier} onChange={e => update({ multiplier: Number(e.target.value) })} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Days (0=Sun..6=Sat):</span>
              <Input className="flex-1" placeholder="e.g. 1,3,5" value={(item.daysOfWeek ?? []).join(",")}
                onChange={e => update({ daysOfWeek: e.target.value.split(",").map(x => Number(x.trim())).filter(n => Number.isFinite(n)) })} />
              <span className="text-muted-foreground">Hours:</span>
              <Input className="w-16" type="number" value={item.startHour ?? 0} onChange={e => update({ startHour: Number(e.target.value) })} />
              <span>—</span>
              <Input className="w-16" type="number" value={item.endHour ?? 24} onChange={e => update({ endHour: Number(e.target.value) })} />
            </div>
          </div>
        )} />
    </>
  );
}

function LoyaltyItemRulesTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  return (
    <>
      <Toggle label="Item-specific bonuses enabled" checked={s.itemRules.enabled}
        onChange={v => set(p => ({ ...p, itemRules: { ...p.itemRules, enabled: v } }))} />
      <ListEditor items={s.itemRules.rules}
        onChange={rules => set(p => ({ ...p, itemRules: { ...p.itemRules, rules } }))}
        addLabel="Add rule"
        makeNew={() => ({ id: `ir-${Date.now()}`, scope: "item" as const, refId: 0, multiplier: 1, bonusPoints: 0, earnsStampCardId: "" })}
        render={(item, _i, update, remove) => (
          <div className="flex items-center gap-2">
            <Select value={item.scope} onChange={v => update({ scope: v })}
              options={[{ value: "item", label: "Menu item id" }, { value: "category", label: "Category id" }]} />
            <Input className="w-24" type="number" placeholder="Ref id" value={item.refId} onChange={e => update({ refId: Number(e.target.value) })} />
            <Input className="w-24" type="number" step="0.1" placeholder="× mult" value={item.multiplier ?? 1} onChange={e => update({ multiplier: Number(e.target.value) })} />
            <Input className="w-24" type="number" placeholder="+ pts" value={item.bonusPoints ?? 0} onChange={e => update({ bonusPoints: Number(e.target.value) })} />
            <Input className="w-32" placeholder="Stamp card id" value={item.earnsStampCardId ?? ""} onChange={e => update({ earnsStampCardId: e.target.value })} />
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        )} />
    </>
  );
}

function LoyaltyFamilyTab({ s, set }: { s: Loyalty2Cfg; set: Setter }) {
  const f = s.family;
  return (
    <>
      <Toggle label="Family accounts enabled (members share rewards)" checked={f.enabled}
        onChange={v => set(p => ({ ...p, family: { ...p.family, enabled: v } }))} />
      <Row>
        <Field label="Max members per family"><Input type="number" value={f.maxMembers} onChange={e => set(p => ({ ...p, family: { ...p.family, maxMembers: Number(e.target.value) } }))} /></Field>
        <Field label="Sharing">
          <div className="flex flex-col gap-1">
            <Toggle label="Share points" checked={f.sharePoints} onChange={v => set(p => ({ ...p, family: { ...p.family, sharePoints: v } }))} />
            <Toggle label="Share cashback" checked={f.shareCashback} onChange={v => set(p => ({ ...p, family: { ...p.family, shareCashback: v } }))} />
          </div>
        </Field>
      </Row>
    </>
  );
}

// Legacy compat wrapper (unused — kept for the old shape so older code doesn't error).
interface LoyaltyTier { id: string; name: string; threshold: number; multiplier: number; }
interface _LegacyLoyaltyCfg { enabled: boolean; pointsPerCurrencyUnit: number; redemptionRate: number; tiers: LoyaltyTier[]; expiryMonths: number; signupBonus: number; birthdayBonus: number; referralBonus: number; }
function _UnusedLegacyLoyaltySection() {
  const defaults: _LegacyLoyaltyCfg = { enabled: false, pointsPerCurrencyUnit: 1, redemptionRate: 0.05, tiers: [], expiryMonths: 0, signupBonus: 0, birthdayBonus: 0, referralBonus: 0 };
  return (
    <SettingForm section="loyalty_legacy_unused" defaults={defaults}>
      {(s, set) => (
        <>
          <Toggle label="Loyalty program enabled" checked={s.enabled} onChange={v => set(p => ({ ...p, enabled: v }))} />
          <Row>
            <Field label="Points per currency unit" hint="e.g. 1 means ₹1 spent earns 1 point.">
              <Input type="number" step="0.1" value={s.pointsPerCurrencyUnit} onChange={e => set(p => ({ ...p, pointsPerCurrencyUnit: Number(e.target.value) }))} />
            </Field>
            <Field label="Redemption rate" hint="Currency value per point on redemption (e.g. 0.05 = ₹0.05 per point).">
              <Input type="number" step="0.01" value={s.redemptionRate} onChange={e => set(p => ({ ...p, redemptionRate: Number(e.target.value) }))} />
            </Field>
          </Row>
          <Row>
            <Field label="Sign-up bonus (points)"><Input type="number" value={s.signupBonus} onChange={e => set(p => ({ ...p, signupBonus: Number(e.target.value) }))} /></Field>
            <Field label="Birthday bonus (points)"><Input type="number" value={s.birthdayBonus} onChange={e => set(p => ({ ...p, birthdayBonus: Number(e.target.value) }))} /></Field>
          </Row>
          <Row>
            <Field label="Referral bonus (points)"><Input type="number" value={s.referralBonus} onChange={e => set(p => ({ ...p, referralBonus: Number(e.target.value) }))} /></Field>
            <Field label="Points expiry (months)" hint="0 = never expires"><Input type="number" value={s.expiryMonths} onChange={e => set(p => ({ ...p, expiryMonths: Number(e.target.value) }))} /></Field>
          </Row>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Tiers</p>
          <ListEditor
            items={s.tiers}
            onChange={items => set(p => ({ ...p, tiers: items }))}
            addLabel="Add tier"
            makeNew={() => ({ id: `tier-${Date.now()}`, name: "", threshold: 0, multiplier: 1 })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Tier name" value={item.name} onChange={e => update({ name: e.target.value })} />
                <span className="text-xs text-muted-foreground">at</span>
                <Input className="w-28" type="number" placeholder="Threshold" value={item.threshold} onChange={e => update({ threshold: Number(e.target.value) })} />
                <span className="text-xs text-muted-foreground">pts ·</span>
                <Input className="w-24" type="number" step="0.05" placeholder="Multiplier" value={item.multiplier ?? 1} onChange={e => update({ multiplier: Number(e.target.value) })} title="Earn-rate multiplier (e.g. 1.5× for Gold)" />
                <span className="text-xs text-muted-foreground">×</span>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />
        </>
      )}
    </SettingForm>
  );
}
