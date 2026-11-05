/** WebVTT, the text a player reads a video's chapters and captions from. */

/** Seconds as `HH:MM:SS.mmm`. WebVTT tolerates a missing hours field; players vary, so always emit it. */
export const formatVttTime = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const ms = Math.round(clamped * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const rest = ms % 1000;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
};
