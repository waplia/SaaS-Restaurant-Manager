import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useSetting, useSaveSetting } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Save } from "lucide-react";

interface Props<T> {
  section: string;
  defaults: T;
  children: (state: T, setState: (updater: (prev: T) => T) => void) => ReactNode;
  description?: ReactNode;
  validate?: (state: T) => string | null;
}

export function SettingForm<T extends object>({ section, defaults, children, description, validate }: Props<T>) {
  const { data, isLoading } = useSetting<T>(section);
  const save = useSaveSetting<T>(section);
  const { toast } = useToast();
  const [state, setState] = useState<T>(defaults);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      const merged = { ...defaults, ...(data.data ?? {}) };
      setState(merged);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.updatedAt]);

  const update = (updater: (prev: T) => T) => {
    setState(prev => {
      const next = updater(prev);
      setDirty(true);
      return next;
    });
  };

  const onSave = async () => {
    if (validate) {
      const err = validate(state);
      if (err) {
        toast({ title: "Cannot save", description: err, variant: "destructive" });
        return;
      }
    }
    try {
      await save.mutateAsync(state);
      toast({ title: "Settings saved" });
      setDirty(false);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="space-y-5">{children(state, update)}</div>
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
        <Button onClick={onSave} disabled={save.isPending || !dirty}>
          {save.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export function Field({
  label, hint, children, required,
}: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

export function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-accent/40 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </label>
  );
}

export function Select<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function ListEditor<T>({
  items, onChange, render, addLabel, makeNew,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, idx: number, update: (patch: Partial<T>) => void, remove: () => void) => ReactNode;
  addLabel: string;
  makeNew: () => T;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="border border-border rounded-lg p-3 bg-card">
          {render(
            item,
            idx,
            (patch) => onChange(items.map((x, i) => i === idx ? { ...x, ...patch } : x)),
            () => onChange(items.filter((_, i) => i !== idx)),
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, makeNew()])}>
        + {addLabel}
      </Button>
    </div>
  );
}
