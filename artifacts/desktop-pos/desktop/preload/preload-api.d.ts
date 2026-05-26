import type { KhanalagaoDesktopApi } from "./index";

declare global {
  interface Window {
    khanalagao: KhanalagaoDesktopApi;
  }
}

export {};
