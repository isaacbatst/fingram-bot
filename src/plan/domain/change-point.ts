export type ChangePoint = { month: number; amount: number };

export function getActiveValue(
  changePoints: ChangePoint[],
  month: number,
  fallback = 0,
): number {
  let active: ChangePoint | undefined;
  for (const cp of changePoints) {
    if (cp.month <= month) {
      if (!active || cp.month > active.month) {
        active = cp;
      }
    }
  }
  return active?.amount ?? fallback;
}
