import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  COUNTRY_CODES,
  DEFAULT_ISO,
  parsePhone,
  resolveCountry,
  formatPhone,
  type CountryCode,
} from "@workspace/phone-utils";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  defaultCountry?: string;
  onBlur?: () => void;
  name?: string;
}

/**
 * Browser-locale defaulted country for the public marketing site, since
 * there is no signed-in restaurant context here. Falls back to "IN" when
 * the locale can't be parsed.
 */
function defaultIsoFromBrowser(): string {
  if (typeof navigator === "undefined") return DEFAULT_ISO;
  const lang = navigator.language ?? "";
  const region = lang.includes("-") ? lang.split("-")[1] : "";
  return region ? region.toUpperCase() : DEFAULT_ISO;
}

export function PhoneInput({
  value,
  onChange,
  placeholder = "9876543210",
  required,
  id,
  disabled,
  className,
  defaultCountry,
  onBlur,
  name,
}: PhoneInputProps) {
  const effectiveDefault = defaultCountry ?? defaultIsoFromBrowser();
  const parsed = useMemo(
    () => parsePhone(value, effectiveDefault),
    [value, effectiveDefault],
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const displayCountry =
    parsed.country.iso ? parsed.country : resolveCountry(effectiveDefault);

  function handleTyped(raw: string) {
    const m = raw.match(/^\s*(\+|00)\s*([\d\s\-]*)$/);
    if (m) {
      const p = parsePhone("+" + m[2].replace(/\D+/g, ""), displayCountry.iso);
      emit(p.country, p.national);
      return;
    }
    emit(displayCountry, raw);
  }

  function emit(country: CountryCode, national: string) {
    onChange(formatPhone(country, national));
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
    <div className={cn("flex gap-2 relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 h-10 px-2 min-w-[6.5rem] justify-between rounded-md border border-input bg-background text-sm hover:bg-accent disabled:opacity-50"
      >
        <span className="text-base leading-none">{displayCountry.flag}</span>
        <span className="font-medium">{displayCountry.code}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>
      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={required}
        disabled={disabled}
        value={parsed.national}
        onChange={e => handleTyped(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                const selected = c.iso === displayCountry.iso;
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
