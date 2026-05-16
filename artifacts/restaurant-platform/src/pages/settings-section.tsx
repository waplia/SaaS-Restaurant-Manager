import { useParams, Redirect } from "wouter";
import WhatsAppSection from "./settings-whatsapp";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { SettingsLayout, SETTINGS_GROUPS, type SectionKey } from "@/components/settings/SettingsLayout";
import { SettingForm, Field, Row, Toggle, Select, ListEditor } from "@/components/settings/SettingForm";
import { useRestaurantInfo, useSubscription, useRestaurantId, useUpdateRestaurant } from "@/lib/hooks";
import { Trash2, ExternalLink, Lock, FileDown } from "lucide-react";
import { Link } from "wouter";

const OWNER_ONLY_KEYS = new Set<SectionKey>([
  "general", "email", "payment", "billing", "roles", "ai", "theme",
  "currencies", "taxes", "loyalty", "discounts", "whatsapp",
]);

const ALLOWED_KEYS = new Set<SectionKey>([
  "general", "app", "shifts", "open-close", "branch", "currencies",
  "email", "taxes", "payment", "theme", "roles", "billing",
  "reservation", "about-us", "customer-site", "receipt", "printer",
  "downloads", "menu-image", "delivery", "allergens", "kot",
  "cancellation-reasons", "order-settings", "refund-reasons",
  "ai", "kiosk", "loyalty", "discounts", "whatsapp",
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

  return (
    <SettingsLayout activeKey={sectionParam} title={meta?.label ?? "Settings"}>
      {renderSection(sectionParam)}
    </SettingsLayout>
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
    case "ai": return <AiSection />;
    case "kiosk": return <KioskSection />;
    case "loyalty": return <LoyaltySection />;
    case "discounts": return <DiscountsSection />;
    case "whatsapp": return <WhatsAppSection />;
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
            <Field label="Contact phone"><Input value={s.contactPhone} onChange={e => set(p => ({ ...p, contactPhone: e.target.value }))} /></Field>
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
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";

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
        <Input placeholder="Phone" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
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
  const defaults: EmailCfg = {
    senderName: "Khana Lagao", replyTo: "",
    templates: {
      orderConfirmation: { subject: "Your order #{order_number} is confirmed", body: "Hi {customer_name},\n\nThanks for ordering with us! Your order #{order_number} totalling {total} is confirmed and will be ready shortly.\n\n— {restaurant_name}" },
      receipt: { subject: "Receipt for order #{order_number}", body: "Thanks for dining with us. Your receipt is attached.\n\nTotal: {total}\nPayment: {payment_method}" },
      staffInvite: { subject: "You've been invited to {restaurant_name}", body: "Hi {staff_name},\n\nYou've been invited to join {restaurant_name} on Khana Lagao. Click the link to set your password: {invite_link}" },
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

/* ---------------- 9. Payment ---------------- */
interface PaymentMethodCfg { id: string; label: string; enabled: boolean; surchargePct: number; }
interface PaymentCfg {
  methods: PaymentMethodCfg[];
  tipPresets: number[]; // %
  rounding: "none" | "nearest" | "up" | "down";
  roundingPrecision: number;
  mandatoryTendered: boolean; showChangeDue: boolean;
}
function PaymentSection() {
  const defaults: PaymentCfg = {
    methods: [
      { id: "cash", label: "Cash", enabled: true, surchargePct: 0 },
      { id: "card", label: "Card", enabled: true, surchargePct: 0 },
      { id: "upi", label: "UPI", enabled: true, surchargePct: 0 },
      { id: "wallet", label: "Wallet", enabled: false, surchargePct: 0 },
      { id: "bank", label: "Bank transfer", enabled: false, surchargePct: 0 },
      { id: "online", label: "Online (Stripe / Razorpay)", enabled: true, surchargePct: 0 },
    ],
    tipPresets: [0, 5, 10, 15, 20],
    rounding: "nearest", roundingPrecision: 1,
    mandatoryTendered: true, showChangeDue: true,
  };
  return (
    <SettingForm section="payment" defaults={defaults}
      description="Accepted methods and checkout behavior. Live keys for online gateways stay in Replit Secrets.">
      {(s, set) => (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Methods</p>
          <div className="space-y-2">
            {s.methods.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                <input type="checkbox" checked={m.enabled} onChange={e => set(p => ({ ...p, methods: p.methods.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x) }))} />
                <span className="font-medium text-sm flex-1">{m.label}</span>
                <span className="text-xs text-muted-foreground">Surcharge %</span>
                <Input className="w-20 h-8" type="number" step="0.1" value={m.surchargePct}
                  onChange={e => set(p => ({ ...p, methods: p.methods.map((x, j) => j === i ? { ...x, surchargePct: Number(e.target.value) } : x) }))} />
              </div>
            ))}
          </div>
          <Field label="Tip presets (%)" hint="Comma-separated percentages shown at checkout">
            <Input value={s.tipPresets.join(",")} onChange={e => set(p => ({ ...p, tipPresets: e.target.value.split(",").map(x => Number(x.trim())).filter(n => !isNaN(n)) }))} />
          </Field>
          <Row>
            <Field label="Rounding rule">
              <Select value={s.rounding} onChange={v => set(p => ({ ...p, rounding: v as PaymentCfg["rounding"] }))} options={[
                { value: "none", label: "No rounding" }, { value: "nearest", label: "Nearest" }, { value: "up", label: "Always up" }, { value: "down", label: "Always down" },
              ]} />
            </Field>
            <Field label="Rounding precision"><Input type="number" step="0.01" value={s.roundingPrecision} onChange={e => set(p => ({ ...p, roundingPrecision: Number(e.target.value) }))} /></Field>
          </Row>
          <Toggle label="Mandatory tendered-cash entry" checked={s.mandatoryTendered} onChange={v => set(p => ({ ...p, mandatoryTendered: v }))} />
          <Toggle label="Show change due on screen and receipt" checked={s.showChangeDue} onChange={v => set(p => ({ ...p, showChangeDue: v }))} />
        </>
      )}
    </SettingForm>
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
          <Field label="Logo URL"><Input value={s.logoUrl} onChange={e => set(p => ({ ...p, logoUrl: e.target.value }))} placeholder="https://…/logo.png" /></Field>
          <Field label="Favicon URL"><Input value={s.faviconUrl} onChange={e => set(p => ({ ...p, faviconUrl: e.target.value }))} /></Field>
          <Field label="Login background image URL"><Input value={s.loginBgUrl} onChange={e => set(p => ({ ...p, loginBgUrl: e.target.value }))} /></Field>
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
                    onChange={e => set(p => ({ ...p, [k as string]: e.target.checked }) as ReservationCfg)} />
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
          <Field label="Hero image URL"><Input value={s.heroImage} onChange={e => set(p => ({ ...p, heroImage: e.target.value }))} /></Field>
          <Field label="Awards & recognition"><Textarea rows={2} value={s.awards} onChange={e => set(p => ({ ...p, awards: e.target.value }))} /></Field>
          <Field label="Photo gallery (one URL per line)">
            <Textarea rows={4} value={s.gallery.join("\n")} onChange={e => set(p => ({ ...p, gallery: e.target.value.split("\n").map(x => x.trim()).filter(Boolean) }))} />
          </Field>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Team members</p>
          <ListEditor
            items={s.team}
            onChange={items => set(p => ({ ...p, team: items }))}
            addLabel="Add team member"
            makeNew={() => ({ name: "", role: "", photoUrl: "" })}
            render={(item, _i, update, remove) => (
              <div className="flex items-center gap-2">
                <Input className="flex-1" placeholder="Name" value={item.name} onChange={e => update({ name: e.target.value })} />
                <Input className="flex-1" placeholder="Role" value={item.role} onChange={e => update({ role: e.target.value })} />
                <Input className="flex-1" placeholder="Photo URL" value={item.photoUrl} onChange={e => update({ photoUrl: e.target.value })} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={remove}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          />
        </>
      )}
    </SettingForm>
  );
}

/* ---------------- 15. Customer Site ---------------- */
interface CustomerSiteCfg {
  enabled: boolean; subdomain: string;
  heroHeadline: string; heroSubcopy: string;
  featuredItemIds: number[];
  socials: { instagram: string; facebook: string; twitter: string };
  mapEmbedUrl: string;
  seoTitle: string; seoDescription: string; ogImageUrl: string;
  accentColor: string;
}
function CustomerSiteSection() {
  const defaults: CustomerSiteCfg = {
    enabled: false, subdomain: "",
    heroHeadline: "", heroSubcopy: "",
    featuredItemIds: [],
    socials: { instagram: "", facebook: "", twitter: "" },
    mapEmbedUrl: "", seoTitle: "", seoDescription: "", ogImageUrl: "",
    accentColor: "#c2410c",
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
      },
    }, window.location.origin);
  }, [iframeReady, s.heroHeadline, s.heroSubcopy, s.socials, s.mapEmbedUrl, s.seoTitle, s.seoDescription, s.ogImageUrl, s.accentColor]);

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
          <Field label="Twitter / X URL"><Input value={s.socials.twitter} onChange={e => set(p => ({ ...p, socials: { ...p.socials, twitter: e.target.value } }))} /></Field>
          <Field label="Google Maps embed URL"><Input value={s.mapEmbedUrl} onChange={e => set(p => ({ ...p, mapEmbedUrl: e.target.value }))} /></Field>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">SEO</p>
          <Field label="SEO title"><Input value={s.seoTitle} onChange={e => set(p => ({ ...p, seoTitle: e.target.value }))} /></Field>
          <Field label="SEO description"><Textarea rows={2} value={s.seoDescription} onChange={e => set(p => ({ ...p, seoDescription: e.target.value }))} /></Field>
          <Field label="OG image URL"><Input value={s.ogImageUrl} onChange={e => set(p => ({ ...p, ogImageUrl: e.target.value }))} /></Field>
          <Field label="Accent color (hex)" hint="Used for buttons, headings and highlights on the public site.">
            <div className="flex items-center gap-2">
              <input type="color" value={s.accentColor || "#c2410c"} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))}
                className="h-9 w-12 rounded border border-input bg-background cursor-pointer" />
              <Input value={s.accentColor} onChange={e => set(p => ({ ...p, accentColor: e.target.value }))} className="flex-1" />
            </div>
          </Field>
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
  showTaxBreakdown: boolean; showTipLine: boolean;
  feedbackQrUrl: string;
  paperSize: "58mm" | "80mm" | "a5";
  fontSize: "small" | "medium" | "large";
  language: string;
}
function ReceiptSection() {
  const defaults: ReceiptCfg = {
    headerLogo: "", footerText: "Thank you for dining with us!",
    showTaxBreakdown: true, showTipLine: true,
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

/* ---------------- 28. Loyalty Program ---------------- */
interface LoyaltyTier { id: string; name: string; threshold: number; multiplier: number; }
interface LoyaltyCfg {
  enabled: boolean;
  pointsPerCurrencyUnit: number; redemptionRate: number;
  signupBonus: number; birthdayBonus: number; referralBonus: number;
  tiers: LoyaltyTier[];
  expiryMonths: number;
}
function LoyaltySection() {
  const defaults: LoyaltyCfg = {
    enabled: false,
    pointsPerCurrencyUnit: 1, redemptionRate: 0.05,
    signupBonus: 100, birthdayBonus: 50, referralBonus: 200,
    tiers: [
      { id: "bronze", name: "Bronze", threshold: 0, multiplier: 1 },
      { id: "silver", name: "Silver", threshold: 1000, multiplier: 1.25 },
      { id: "gold", name: "Gold", threshold: 5000, multiplier: 1.5 },
    ],
    expiryMonths: 0,
  };
  return (
    <SettingForm section="loyalty" defaults={defaults}>
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
