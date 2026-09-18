/// <reference types="vite/client" />
import type { LabApi } from '../preload/index.js';

/**
 * A read-only handle on the 3D view, for automated drivers. A Gahallian is a
 * couple of pixels at the default camera, so "click a being" is not something a
 * script can do by guessing coordinates — it has to ask where one is.
 */
export interface WorldProbe {
  drawnIds(): number[];
  screenPositionOf(id: number): { x: number; y: number } | null;
}

declare global {
  interface Window {
    lab?: LabApi;
    __ygg?: WorldProbe;
  }
}

export {};
