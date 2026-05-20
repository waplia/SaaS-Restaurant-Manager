/**
 * Shared, dependency-free utilities for country-aware phone-number handling.
 *
 * Storage format used across the system:  `+<dial> <national>`
 *   - `+91 9876543210`
 *   - `+1 5551234567`
 *
 * This package is intentionally framework-free so it can be consumed by:
 *   - The Express API server (server-side normalisation before insert)
 *   - The React web artifacts (PhoneInput components)
 *   - The Expo / React Native mobile app
 */

export interface CountryCode {
  /** Display name (English). */
  name: string;
  /** ISO-3166-1 alpha-2 code, e.g. "IN". */
  iso: string;
  /** Dialing code including a leading "+", e.g. "+91". */
  code: string;
  /** Regional indicator emoji flag. */
  flag: string;
}

/** Default country used when no restaurant context is available. */
export const DEFAULT_ISO = "IN";
export const DEFAULT_CODE = "+91";

/** Convert an ISO-3166 alpha-2 code into its regional-indicator emoji flag. */
export function isoFlag(iso: string): string {
  return iso
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65)))
    .join("");
}

// [iso, dial(without +), name]
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

/** Master country list, alphabetically sorted. Frozen so callers can't mutate. */
export const COUNTRY_CODES: ReadonlyArray<CountryCode> = Object.freeze(
  RAW.map(([iso, dial, name]) => ({
    iso,
    code: `+${dial}`,
    name,
    flag: isoFlag(iso),
  })).sort((a, b) => a.name.localeCompare(b.name)),
);

const BY_ISO = new Map<string, CountryCode>(COUNTRY_CODES.map((c) => [c.iso, c]));
// Pre-sort dial-codes longest-first so we always match the most specific
// region (e.g. "+1268" Antigua wins over "+1" US/Canada).
const DIAL_CODES_LONGEST_FIRST: string[] = Array.from(
  new Set(COUNTRY_CODES.map((c) => c.code)),
).sort((a, b) => b.length - a.length);

/** Look up a country by ISO-2 (case-insensitive). */
export function countryByIso(iso: string | null | undefined): CountryCode | undefined {
  if (!iso) return undefined;
  return BY_ISO.get(iso.toUpperCase());
}

/** Look up a country by dial code, e.g. "+91". Returns the first match. */
export function countryByDial(code: string | null | undefined): CountryCode | undefined {
  if (!code) return undefined;
  const norm = code.startsWith("+") ? code : `+${code}`;
  return COUNTRY_CODES.find((c) => c.code === norm);
}

/** Resolve a country, falling back to {@link DEFAULT_ISO}. */
export function resolveCountry(iso?: string | null): CountryCode {
  return countryByIso(iso) ?? countryByIso(DEFAULT_ISO)!;
}

/**
 * Split a stored phone string into its country + national parts.
 *
 * Accepts any of:
 *   - `"+91 9876543210"`  (canonical storage format)
 *   - `"+919876543210"`   (no space)
 *   - `"+1-555-123-4567"` (dashes)
 *   - `"9876543210"`      (national-only — assumed to be {@link defaultIso})
 *   - `""` / `null`       (empty)
 */
export function parsePhone(
  value: string | null | undefined,
  defaultIso: string = DEFAULT_ISO,
): { country: CountryCode; national: string } {
  const def = resolveCountry(defaultIso);
  const v = (value ?? "").trim();
  if (!v) return { country: def, national: "" };

  if (v.startsWith("+")) {
    for (const code of DIAL_CODES_LONGEST_FIRST) {
      if (v.startsWith(code)) {
        const country = countryByDial(code) ?? def;
        const national = v.slice(code.length).replace(/^[\s\-]+/, "");
        return { country, national };
      }
    }
    // Unknown +-prefix — strip the "+" so it isn't presented as garbage.
    return { country: def, national: v.replace(/^\+/, "") };
  }

  return { country: def, national: v };
}

/** Build the canonical `"+<dial> <national>"` storage string. */
export function formatPhone(country: CountryCode, national: string): string {
  const trimmed = (national ?? "").replace(/[^\d\s\-]/g, "").trim();
  if (!trimmed) return "";
  return `${country.code} ${trimmed}`;
}

/**
 * Normalise an arbitrary user-supplied phone string to the canonical
 * storage format, using `restaurantIso` as the fallback country when the
 * input has no `+`-prefix. Returns `null` when the result is too short
 * to be a usable phone number.
 */
export function normalizePhone(
  raw: string | null | undefined,
  restaurantIso: string | null | undefined = DEFAULT_ISO,
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const { country, national } = parsePhone(trimmed, restaurantIso ?? DEFAULT_ISO);
  // Strip all non-digits from the national part for storage stability.
  const digits = national.replace(/\D+/g, "");
  if (digits.length < 4) return null;
  return `${country.code} ${digits}`;
}

/** Returns true if the value parses to a plausible international phone. */
export function isValidPhone(
  raw: string | null | undefined,
  restaurantIso: string | null | undefined = DEFAULT_ISO,
): boolean {
  return normalizePhone(raw, restaurantIso) != null;
}

/**
 * Produce an E.164-style string with no spaces, e.g. `"+919876543210"`.
 * Useful for SMS / WhatsApp APIs that reject whitespace.
 */
export function toE164(
  raw: string | null | undefined,
  restaurantIso: string | null | undefined = DEFAULT_ISO,
): string | null {
  const n = normalizePhone(raw, restaurantIso);
  if (!n) return null;
  return n.replace(/\s+/g, "");
}
