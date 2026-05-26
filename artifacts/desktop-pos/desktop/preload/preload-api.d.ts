import type { TableTrackDesktopApi } from "./index";

declare global {
  interface Window {
    tabletrack: TableTrackDesktopApi;
  }
}

export {};
