export interface LineRange {
  start: number;
  end: number;
}

export function parseLineRange(startValue: string, endValue: string, totalLines: number): LineRange | null {
  if (!Number.isSafeInteger(totalLines) || totalLines < 1) return null;
  const startText = startValue.trim();
  const endText = endValue.trim();
  if (!/^\d+$/u.test(startText) || !/^\d+$/u.test(endText)) return null;

  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > totalLines) return null;
  return { start, end };
}
