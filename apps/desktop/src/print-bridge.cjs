// Stub for a future local print bridge.
// Real implementations would attach to USB / network thermal printers (ESC/POS)
// and expose a small RPC surface to the renderer via contextBridge.
// This file is intentionally inert; it does not register any handlers.

module.exports = {
  name: "khanalagao-print-bridge",
  status: "stub",
  describe() {
    return {
      vendor: "khanalagao",
      capabilities: [],
      note: "Local printer bridge not yet implemented.",
    };
  },
};
