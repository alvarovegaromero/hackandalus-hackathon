// Compressed demo clock: 1 real minute = 10 crisis minutes by default.
export const DEFAULT_RATIO = 10;

export const crisisMinutes = (elapsedWallMs: number, ratio = DEFAULT_RATIO) =>
  (Math.max(0, elapsedWallMs) / 60_000) * ratio;
