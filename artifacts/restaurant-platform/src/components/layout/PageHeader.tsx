import { ReactNode, ComponentType, isValidElement, createElement } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Alias of `subtitle`. Many pages use the more idiomatic `description`. */
  description?: string;
  actions?: ReactNode;
  /** Alias of `actions` for callsites that pass a single element. */
  action?: ReactNode;
  /** Optional decorative leading icon. Accepts a React node or a component (e.g. a lucide-react icon). */
  icon?: ReactNode | ComponentType<{ className?: string }>;
  /** Alternative to `actions` — children passed inside <PageHeader> are rendered on the right. */
  children?: ReactNode;
}

function renderIcon(icon: PageHeaderProps["icon"]): ReactNode {
  if (icon == null || typeof icon === "boolean") return null;
  if (typeof icon === "function") return createElement(icon as ComponentType<{ className?: string }>, { className: "w-5 h-5" });
  if (isValidElement(icon) || typeof icon === "string" || typeof icon === "number") return icon;
  return icon as ReactNode;
}

export function PageHeader({ title, subtitle, description, actions, action, icon, children }: PageHeaderProps) {
  const sub = subtitle ?? description;
  const trailing = actions ?? action ?? children;
  const iconNode = renderIcon(icon);
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border bg-background/80 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70 sticky top-0 z-10">
      <div className="flex items-center gap-3 min-w-0">
        {iconNode && <div className="flex-shrink-0 text-muted-foreground">{iconNode}</div>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground tracking-tight truncate">{title}</h1>
          {sub && <p className="text-sm text-muted-foreground mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
      {trailing && <div className="flex items-center gap-2 flex-shrink-0">{trailing}</div>}
    </div>
  );
}
