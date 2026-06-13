/// <reference types="vite/client" />
import type { LabApi } from '../preload/index.js';

declare global {
  interface Window {
    lab?: LabApi;
  }
}

export {};
