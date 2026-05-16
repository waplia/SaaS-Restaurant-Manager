import { Check, X } from "lucide-react";

export interface ComparisonRow { label: string; values: (boolean | string)[] }
export interface ComparisonProps { columns: string[]; rows: ComparisonRow[]; highlightCol?: number }

export function ComparisonTable({ columns, rows, highlightCol = 0 }: ComparisonProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-4 font-semibold text-muted-foreground w-1/3">Capability</th>
            {columns.map((c, i) => (
              <th key={c} className={`p-4 font-semibold ${i === highlightCol ? "text-primary bg-primary/5" : "text-foreground"}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              <td className="p-4 font-medium">{row.label}</td>
              {row.values.map((v, ci) => (
                <td key={ci} className={`p-4 text-center ${ci === highlightCol ? "bg-primary/5" : ""}`}>
                  {typeof v === "boolean" ? (
                    v ? <Check className="h-4 w-4 text-primary inline" /> : <X className="h-4 w-4 text-muted-foreground/40 inline" />
                  ) : (
                    <span className={ci === highlightCol ? "text-foreground font-medium" : "text-foreground/80"}>{v}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
