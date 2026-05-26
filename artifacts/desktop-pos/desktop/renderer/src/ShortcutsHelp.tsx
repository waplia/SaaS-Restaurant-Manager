const SHORTCUTS: Array<[string, string]> = [
  ["F2", "Focus item search"],
  ["F3", "Switch outlet / counter"],
  ["F4", "Hold current bill"],
  ["F5", "Recall held bill"],
  ["F6", "Print KOT"],
  ["F7", "Print receipt"],
  ["F8", "Pay / charge"],
  ["F9", "Open cash drawer"],
  ["F10", "Shift summary"],
  ["F11", "Toggle fullscreen"],
  ["Ctrl/⌘ + N", "New order"],
  ["Ctrl/⌘ + P", "Reprint last bill"],
  ["Ctrl/⌘ + Enter", "Place order"],
  ["Ctrl/⌘ + F10", "Open settings"],
  ["+ / −", "Adjust last item quantity"],
  ["Delete", "Remove last item"],
  ["Esc", "Close modal / clear focus"],
  ["?", "Show this help"],
  ["F1", "Show this help"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: 24, minWidth: 420, maxHeight: "80vh", overflow: "auto", color: "#f4f5f7" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Keyboard shortcuts</h3>
          <button onClick={onClose} style={{ background: "transparent", color: "#f4f5f7", border: 0, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 8, columnGap: 24, fontSize: 13 }}>
          {SHORTCUTS.map(([k, d]) => (
            <>
              <span key={`d-${k}`} style={{ opacity: 0.8 }}>{d}</span>
              <kbd key={`k-${k}`} style={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 4, padding: "2px 8px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{k}</kbd>
            </>
          ))}
        </div>
        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
          POS-page-specific shortcuts also work inside the embedded web terminal once focused.
        </p>
      </div>
    </div>
  );
}
