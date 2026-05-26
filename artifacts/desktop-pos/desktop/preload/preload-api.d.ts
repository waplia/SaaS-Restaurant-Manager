import type { KhanaLagaoDesktopApi } from "./index";

declare global {
  interface Window {
    khanalagao: KhanaLagaoDesktopApi;
  }
}

export {};
