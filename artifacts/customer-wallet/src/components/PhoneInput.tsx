import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  COUNTRY_CODES,
  DEFAULT_ISO,
  parsePhone,
  resolveCountry,
  formatPhone,
  expectedNationalLength,
  type CountryCode,
} from "@workspace/phone-utils";

interface PhoneInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  autoComplete?: string;
  /** Initial ISO-2 country (default: "IN"). */
  defaultCountry?: string;
  /** Optional test-id (the trigger button reads this). */
  "data-testid"?: string;
  /** Optional test-id for the inner number input. */
  inputTestId?: string;
  autoFocus?: boolean;
}

/**
 * Wallet-themed country-aware phone input. Uses the same shared lib as the
 * back-office and mobile apps for country data + parsing — only the styling
 * differs (wallet uses plain `.input` / Tailwind classes, no shadcn).
 */
export function PhoneInput({
  value,
  onChange,
  placeholder = "98765 43210",
  required,
  id,
  disabled,
  className,
  autoComplete = "tel",
  defaultCountry = DEFAULT_ISO,
  inputTestId,
  autoFocus,
  ...rest
}: PhoneInputProps) {
  const parsed = useMemo(
    () => parsePhone(value, defaultCountry),
    [value, defaultCountry],
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const displayCountry =
    parsed.country.iso ? parsed.country : resolveCountry(defaultCountry);

  function emit(country: CountryCode, national: string) {
    const cap = expectedNationalLength(country.iso);
    const digits = national.replace(/\D+/g, "").slice(0, cap);
    onChange(formatPhone(country, digits));
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
    emit(country, parsed.national);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={`flex gap-2 relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid={rest["data-testid"] ?? "btn-country-select"}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 px-3 h-12 rounded-xl border border-zinc-200 bg-white text-sm font-medium min-w-[6.5rem] justify-between disabled:opacity-50"
      >
        <span className="text-base leading-none">{displayCountry.flag}</span>
        <span>{displayCountry.code}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        value={parsed.national}
        onChange={e => emit(displayCountry, e.target.value)}
        placeholder={placeholder}
        maxLength={expectedNationalLength(displayCountry.iso)}
        data-testid={inputTestId}
        className="input flex-1"
      />

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 w-72 max-w-[90vw] bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-zinc-100 relative">
            <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country or code"
              className="w-full h-9 pl-7 pr-7 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700" type="button" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-zinc-500">No matches</div>
            ) : (
              filtered.map(c => {
                const selected = c.iso === displayCountry.iso;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(c)}
                    className={
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-100 " +
                      (selected ? "bg-zinc-50 font-medium" : "")
                    }
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-zinc-500 tabular-nums text-xs">{c.code}</span>
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
