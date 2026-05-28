/**
 * Consistent empty state for nav items whose screen has not been wired
 * yet. The role-based shell ships first; the actual Manager / Inventory
 * / Accountant / Marketing / Delivery module screens land in the
 * follow-up tasks. Until then every nav target lands here so the shell
 * looks complete and never loads forever.
 */
import { colors } from "../ui/components";

interface Props {
  title: string;
  description?: string;
  group?: string;
}

export function ComingSoon({ title, description, group }: Props) {
  return (
    <div style={{
      flex: 1, display: "grid", placeItems: "center", padding: 32,
      background: colors.bg, color: colors.textPrimary,
    }}>
      <div style={{
        maxWidth: 460, textAlign: "center",
        background: colors.panel, border: `1px solid ${colors.border}`,
        borderRadius: 16, padding: "36px 32px",
      }}>
        <div style={{
          width: 56, height: 56, margin: "0 auto 16px",
          display: "grid", placeItems: "center",
          background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`,
          borderRadius: 14, color: "#fff", fontSize: 26,
          boxShadow: `0 6px 20px ${colors.brand}44`,
        }}>✦</div>
        {group && (
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            {group}
          </div>
        )}
        <h2 style={{ margin: "0 0 10px", fontSize: 22, color: colors.textPrimary }}>{title}</h2>
        {description && (
          <p style={{ margin: "0 0 16px", color: colors.textDim, fontSize: 13, lineHeight: 1.6 }}>
            {description}
          </p>
        )}
        <div style={{
          display: "inline-flex", gap: 6, alignItems: "center",
          padding: "6px 12px", borderRadius: 999,
          background: "rgba(234,88,12,0.12)",
          border: "1px solid rgba(234,88,12,0.35)",
          fontSize: 12, color: "#fed7aa", fontWeight: 600,
        }}>
          <span>○</span> Coming soon in this build
        </div>
      </div>
    </div>
  );
}
