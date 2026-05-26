/**
 * Tiny shared UI kit — buttons, inputs, cards. Keeps the renderer
 * dependency-free (no Tailwind in the desktop bundle) and consistent.
 */

import React from "react";

export const colors = {
  bg: "#0b0f17",
  panel: "#111827",
  panelAlt: "#1f2937",
  border: "#1f2937",
  borderStrong: "#374151",
  textPrimary: "#f4f5f7",
  textDim: "#94a3b8",
  textMuted: "#64748b",
  brand: "#ea580c",
  brandHover: "#c2410c",
  brandSoft: "#7c2d12",
  danger: "#dc2626",
  success: "#16a34a",
};

export function Button(
  { children, variant = "primary", style, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" },
) {
  const base: React.CSSProperties = {
    border: 0,
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: rest.disabled ? "not-allowed" : "pointer",
    opacity: rest.disabled ? 0.5 : 1,
    transition: "background 0.12s ease",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: colors.brand, color: "#fff" },
    ghost: { background: colors.panelAlt, color: colors.textPrimary },
    danger: { background: colors.danger, color: "#fff" },
  };
  return <button {...rest} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}

export function Input(
  { style, inputRef, ...rest }:
  React.InputHTMLAttributes<HTMLInputElement> & { inputRef?: React.Ref<HTMLInputElement> },
) {
  return (
    <input
      {...rest}
      ref={inputRef}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.borderStrong}`,
        color: colors.textPrimary,
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 14,
        width: "100%",
        outline: "none",
        ...style,
      }}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 6, fontWeight: 500 }}>{children}</div>;
}

export function Card({ children, onClick, selected, style }: {
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: colors.panel,
        border: `2px solid ${selected ? colors.brand : colors.border}`,
        borderRadius: 12,
        padding: 20,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.12s, transform 0.06s",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Banner({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  const palette = kind === "error"
    ? { bg: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.4)", color: "#fca5a5" }
    : { bg: "rgba(234,88,12,0.10)", border: "rgba(234,88,12,0.35)", color: "#fed7aa" };
  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.color,
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
    }}>{children}</div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size,
        border: `2px solid ${colors.borderStrong}`,
        borderTopColor: colors.brand,
        borderRadius: "50%",
        animation: "tt-spin 0.8s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

export function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 32 }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        fontSize: 28, fontWeight: 800, letterSpacing: -0.5,
      }}>
        <span style={{
          width: 36, height: 36, borderRadius: 8,
          background: colors.brand, color: "#fff",
          display: "grid", placeItems: "center", fontSize: 18,
        }}>K</span>
        <span>Khanalagao POS</span>
      </div>
      {subtitle && <div style={{ color: colors.textDim, fontSize: 13, marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
}

export function FullscreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: colors.bg, padding: 24,
    }}>
      <style>{`@keyframes tt-spin { to { transform: rotate(360deg); } }`}</style>
      {children}
    </div>
  );
}
