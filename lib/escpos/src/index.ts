/**
 * Shared ESC/POS template + byte-encoder used by both mobile app and the
 * desktop print bridge. Pure TS — no Node-only imports — so it bundles for
 * React Native, Vite, and the Electron preload context alike.
 */
export * from "./templates";
export * from "./upi-qr";
export * from "./bytes";
