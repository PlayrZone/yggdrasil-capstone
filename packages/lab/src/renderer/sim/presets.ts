/**
 * Speed presets — the only part of the time model the UI needs. The rate maths
 * (and the clock that obeys it) live in the worker's host; this file is pure
 * labels and a multiplier, so the UI bundle stays free of the engine.
 */
export interface SpeedPreset {
  mult: number;
  label: string;
  rate: string;
}

// Each preset shows how long a day takes at that rate (1× = 2 h / day).
export const SPEED_PRESETS: SpeedPreset[] = [
  { mult: 1, label: '1×', rate: '2h / day' },
  { mult: 2, label: '2×', rate: '1h / day' },
  { mult: 6, label: '6×', rate: '20m / day' },
  { mult: 30, label: '30×', rate: '4m / day' },
  { mult: 120, label: '120×', rate: '1m / day' },
  { mult: 600, label: '600×', rate: '12s / day' },
  { mult: 2400, label: '2400×', rate: '3s / day' },
];
