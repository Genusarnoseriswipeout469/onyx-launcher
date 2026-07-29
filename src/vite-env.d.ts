/// <reference types="vite/client" />

import type { OnyxBridge } from "./types";

declare global {
  interface Window {
    onyx: OnyxBridge;
  }
}

export {};
