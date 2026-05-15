import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CountryCode {
  code: string;   // dialing code, e.g. "+91"
  iso: string;    // ISO-2, e.g. "IN"
  name: string;   // display name
  flag: string;   // emoji
}

function isoFlag(iso: string): string {
  return iso
    .toUpperCase()
    .split("")
    .map(c => String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65)))
    .join("");
}

// Comprehensive list of ISO-2 countries with international dialing codes.
// Sorted alphabetically by name; India is also offered as the default.
const RAW: Array<[string, string, string]> = [
  ["AF","93","Afghanistan"],["AL","355","Albania"],["DZ","213","Algeria"],["AD","376","Andorra"],
  ["AO","244","Angola"],["AG","1268","Antigua and Barbuda"],["AR","54","Argentina"],["AM","374","Armenia"],
  ["AU","61","Australia"],["AT","43","Austria"],["AZ","994","Azerbaijan"],["BS","1242","Bahamas"],
  ["BH","973","Bahrain"],["BD","880","Bangladesh"],["BB","1246","Barbados"],["BY","375","Belarus"],
  ["BE","32","Belgium"],["BZ","501","Belize"],["BJ","229","Benin"],["BT","975","Bhutan"],
  ["BO","591","Bolivia"],["BA","387","Bosnia and Herzegovina"],["BW","267","Botswana"],["BR","55","Brazil"],
  ["BN","673","Brunei"],["BG","359","Bulgaria"],["BF","226","Burkina Faso"],["BI","257","Burundi"],
  ["KH","855","Cambodia"],["CM","237","Cameroon"],["CA","1","Canada"],["CV","238","Cape Verde"],
  ["CF","236","Central African Republic"],["TD","235","Chad"],["CL","56","Chile"],["CN","86","China"],
  ["CO","57","Colombia"],["KM","269","Comoros"],["CG","242","Congo"],["CD","243","Congo (DRC)"],
  ["CR","506","Costa Rica"],["CI","225","Côte d'Ivoire"],["HR","385","Croatia"],["CU","53","Cuba"],
  ["CY","357","Cyprus"],["CZ","420","Czechia"],["DK","45","Denmark"],["DJ","253","Djibouti"],
  ["DM","1767","Dominica"],["DO","1809","Dominican Republic"],["EC","593","Ecuador"],["EG","20","Egypt"],
  ["SV","503","El Salvador"],["GQ","240","Equatorial Guinea"],["ER","291","Eritrea"],["EE","372","Estonia"],
  ["SZ","268","Eswatini"],["ET","251","Ethiopia"],["FJ","679","Fiji"],["FI","358","Finland"],
  ["FR","33","France"],["GA","241","Gabon"],["GM","220","Gambia"],["GE","995","Georgia"],
  ["DE","49","Germany"],["GH","233","Ghana"],["GR","30","Greece"],["GD","1473","Grenada"],
  ["GT","502","Guatemala"],["GN","224","Guinea"],["GW","245","Guinea-Bissau"],["GY","592","Guyana"],
  ["HT","509","Haiti"],["HN","504","Honduras"],["HK","852","Hong Kong"],["HU","36","Hungary"],
  ["IS","354","Iceland"],["IN","91","India"],["ID","62","Indonesia"],["IR","98","Iran"],
  ["IQ","964","Iraq"],["IE","353","Ireland"],["IL","972","Israel"],["IT","39","Italy"],
  ["JM","1876","Jamaica"],["JP","81","Japan"],["JO","962","Jordan"],["KZ","7","Kazakhstan"],
  ["KE","254","Kenya"],["KI","686","Kiribati"],["KW","965","Kuwait"],["KG","996","Kyrgyzstan"],
  ["LA","856","Laos"],["LV","371","Latvia"],["LB","961","Lebanon"],["LS","266","Lesotho"],
  ["LR","231","Liberia"],["LY","218","Libya"],["LI","423","Liechtenstein"],["LT","370","Lithuania"],
  ["LU","352","Luxembourg"],["MO","853","Macau"],["MG","261","Madagascar"],["MW","265","Malawi"],
  ["MY","60","Malaysia"],["MV","960","Maldives"],["ML","223","Mali"],["MT","356","Malta"],
  ["MH","692","Marshall Islands"],["MR","222","Mauritania"],["MU","230","Mauritius"],["MX","52","Mexico"],
  ["FM","691","Micronesia"],["MD","373","Moldova"],["MC","377","Monaco"],["MN","976","Mongolia"],
  ["ME","382","Montenegro"],["MA","212","Morocco"],["MZ","258","Mozambique"],["MM","95","Myanmar"],
  ["NA","264","Namibia"],["NR","674","Nauru"],["NP","977","Nepal"],["NL","31","Netherlands"],
  ["NZ","64","New Zealand"],["NI","505","Nicaragua"],["NE","227","Niger"],["NG","234","Nigeria"],
  ["KP","850","North Korea"],["MK","389","North Macedonia"],["NO","47","Norway"],["OM","968","Oman"],
  ["PK","92","Pakistan"],["PW","680","Palau"],["PS","970","Palestine"],["PA","507","Panama"],
  ["PG","675","Papua New Guinea"],["PY","595","Paraguay"],["PE","51","Peru"],["PH","63","Philippines"],
  ["PL","48","Poland"],["PT","351","Portugal"],["PR","1787","Puerto Rico"],["QA","974","Qatar"],
  ["RO","40","Romania"],["RU","7","Russia"],["RW","250","Rwanda"],["KN","1869","Saint Kitts & Nevis"],
  ["LC","1758","Saint Lucia"],["VC","1784","Saint Vincent"],["WS","685","Samoa"],["SM","378","San Marino"],
  ["ST","239","São Tomé"],["SA","966","Saudi Arabia"],["SN","221","Senegal"],["RS","381","Serbia"],
  ["SC","248","Seychelles"],["SL","232","Sierra Leone"],["SG","65","Singapore"],["SK","421","Slovakia"],
  ["SI","386","Slovenia"],["SB","677","Solomon Islands"],["SO","252","Somalia"],["ZA","27","South Africa"],
  ["KR","82","South Korea"],["SS","211","South Sudan"],["ES","34","Spain"],["LK","94","Sri Lanka"],
  ["SD","249","Sudan"],["SR","597","Suriname"],["SE","46","Sweden"],["CH","41","Switzerland"],
  ["SY","963","Syria"],["TW","886","Taiwan"],["TJ","992","Tajikistan"],["TZ","255","Tanzania"],
  ["TH","66","Thailand"],["TL","670","Timor-Leste"],["TG","228","Togo"],["TO","676","Tonga"],
  ["TT","1868","Trinidad and Tobago"],["TN","216","Tunisia"],["TR","90","Turkey"],["TM","993","Turkmenistan"],
  ["TV","688","Tuvalu"],["UG","256","Uganda"],["UA","380","Ukraine"],["AE","971","United Arab Emirates"],
  ["GB","44","United Kingdom"],["US","1","United States"],["UY","598","Uruguay"],["UZ","998","Uzbekistan"],
  ["VU","678","Vanuatu"],["VA","379","Vatican City"],["VE","58","Venezuela"],["VN","84","Vietnam"],
  ["YE","967","Yemen"],["ZM","260","Zambia"],["ZW","263","Zimbabwe"],
];

export const COUNTRY_CODES: CountryCode[] = RAW
  .map(([iso, dial, name]) => ({ iso, code: `+${dial}`, name, flag: isoFlag(iso) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const DEFAULT_ISO = "IN";
const DEFAULT_CODE = "+91";

function findCountry(iso?: string, code?: string): CountryCode | undefined {
  if (iso) {
    const byIso = COUNTRY_CODES.find(c => c.iso === iso);
    if (byIso) return byIso;
  }
  if (code) return COUNTRY_CODES.find(c => c.code === code);
  return undefined;
}

/** Splits a stored "+91 9876543210" string into a country and a national-number part. */
function parseStored(value: string | undefined | null): { country: CountryCode; number: string } {
  const v = (value ?? "").trim();
  const def = findCountry(DEFAULT_ISO) ?? COUNTRY_CODES[0];
  if (!v) return { country: def, number: "" };
  // Match the longest known dial-code prefix (so +1268 beats +1 for AG numbers).
  const codes = Array.from(new Set(COUNTRY_CODES.map(c => c.code))).sort((a, b) => b.length - a.length);
  for (const c of codes) {
    if (v.startsWith(c)) {
      const number = v.slice(c.length).replace(/^[\s-]+/, "");
      const country = findCountry(undefined, c) ?? def;
      return { country, number };
    }
  }
  return { country: def, number: v };
}

interface PhoneInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  autoComplete?: string;
}

export function PhoneInput({ value, onChange, placeholder = "9876543210", required, id, disabled, className, autoComplete = "tel" }: PhoneInputProps) {
  const parsed = useMemo(() => parseStored(value), [value]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  function emit(country: CountryCode, number: string) {
    const trimmed = number.replace(/[^\d\s-]/g, "").trim();
    if (!trimmed) {
      onChange("");
      return;
    }
    onChange(`${country.code} ${trimmed}`);
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    const numeric = q.replace(/^\+/, "");
    return COUNTRY_CODES.filter(c =>
      c.name.toLowerCase().includes(q)
      || c.iso.toLowerCase().includes(q)
      || c.code.includes(numeric)
      || c.code.slice(1).startsWith(numeric)
    );
  }, [search]);

  function pick(country: CountryCode) {
    emit(country, parsed.number);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={cn("flex gap-2 relative", className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-10 min-w-[7rem] justify-between gap-1 px-2"
      >
        <span className="text-base leading-none">{parsed.country.flag}</span>
        <span className="text-sm font-medium">{parsed.country.code}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </Button>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        value={parsed.number}
        onChange={e => emit(parsed.country, e.target.value)}
        placeholder={placeholder}
        className="flex-1"
      />

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 w-72 max-w-[90vw] bg-popover border border-border rounded-md shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-border bg-card relative">
            <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country or code"
              className="w-full h-8 pl-7 pr-7 rounded border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" type="button" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
            ) : (
              filtered.map(c => {
                const selected = c.iso === parsed.country.iso;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(c)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent",
                      selected && "bg-accent/60 font-medium",
                    )}
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-muted-foreground tabular-nums text-xs">{c.code}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export defaults for callers that previously read these.
export { DEFAULT_CODE, DEFAULT_ISO };
