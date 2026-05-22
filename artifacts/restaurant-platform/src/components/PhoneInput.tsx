import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COUNTRY_CODES,
  DEFAULT_CODE,
  DEFAULT_ISO,
  parsePhone,
  resolveCountry,
  formatPhone,
  expectedNationalLength,
  type CountryCode,
} from "@workspace/phone-utils";
import { useRestaurantInfo } from "@/lib/hooks";

export type { CountryCode };
export { COUNTRY_CODES, DEFAULT_CODE, DEFAULT_ISO };

interface PhoneInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  autoComplete?: string;
  /**
   * Initial ISO-2 country used when {@link value} is empty / national-only.
   * Defaults to the active restaurant's configured country, falling back
   * to "IN" when nothing is available (e.g. on pre-auth screens).
   */
  defaultCountry?: string;
}

export function PhoneInput({
  value,
  onChange,
  placeholder = "9876543210",
  required,
  id,
  disabled,
  className,
  autoComplete = "tel",
  defaultCountry,
}: PhoneInputProps) {
  // Pick up the restaurant's configured country when no explicit override
  // is given. The hook is always called (React rules of hooks) but its
  // value is only used when defaultCountry is omitted.
  const restaurant = useRestaurantInfo();
  const effectiveDefault =
    defaultCountry ?? restaurant.data?.country ?? DEFAULT_ISO;

  const parsed = useMemo(
    () => parsePhone(value, effectiveDefault),
    [value, effectiveDefault],
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  function emit(country: CountryCode, national: string) {
    const cap = expectedNationalLength(country.iso);
    const digits = national.replace(/\D+/g, "").slice(0, cap);
    onChange(formatPhone(country, digits));
  }

  // When the user types/pastes a number that begins with an international
  // prefix ("+44…", "0044…", "00 44 …"), auto-detect the country from the
  // dial code and switch the flag/code accordingly so the SMS is delivered
  // to the right region without forcing the user to open the country picker.
  function handleTyped(raw: string) {
    const m = raw.match(/^\s*(\+|00)\s*([\d\s\-]*)$/);
    if (m) {
      // Always re-parse when input starts with "+" or "00" — never let the
      // remaining digits be treated as a national number under the current
      // country (would silently mis-route SMS to the wrong country).
      const p = parsePhone("+" + m[2].replace(/\D+/g, ""), displayCountry.iso);
      emit(p.country, p.national);
      return;
    }
    emit(displayCountry, raw);
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

  // Keep dropdown showing the resolved-default country even before the
  // user types anything (so empty-state still shows the right flag).
  const displayCountry = parsed.country.iso ? parsed.country : resolveCountry(effectiveDefault);

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
        className="h-12 min-w-[7rem] justify-between gap-1 px-3 text-base"
      >
        <span className="text-lg leading-none">{displayCountry.flag}</span>
        <span className="text-base font-medium">{displayCountry.code}</span>
        <ChevronDown className="w-4 h-4 opacity-60" />
      </Button>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        value={parsed.national}
        onChange={e => handleTyped(e.target.value)}
        placeholder={placeholder}
        // No maxLength — the browser truncates pasted international numbers
        // ("+919602374514") before our onChange handler can detect the dial
        // code and switch country. `emit()` slices to the per-country cap
        // after parsing, so typed-past-cap input is still bounded.
        className="flex-1 h-12 text-base"
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
