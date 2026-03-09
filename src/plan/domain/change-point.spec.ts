import { describe, it, expect } from 'vitest';
import { getActiveValue } from './change-point';

describe('getActiveValue', () => {
  it('should return fallback when changePoints is empty', () => {
    expect(getActiveValue([], 5)).toBe(0);
  });

  it('should return custom fallback when no change point qualifies', () => {
    expect(getActiveValue([{ month: 10, amount: 5000 }], 5, 3000)).toBe(3000);
  });

  it('should return amount of single change point at month 0', () => {
    const points = [{ month: 0, amount: 10000 }];
    expect(getActiveValue(points, 0)).toBe(10000);
    expect(getActiveValue(points, 50)).toBe(10000);
  });

  it('should return correct value with multiple change points', () => {
    const points = [
      { month: 0, amount: 33000 },
      { month: 40, amount: 38000 },
    ];
    expect(getActiveValue(points, 0)).toBe(33000);
    expect(getActiveValue(points, 39)).toBe(33000);
    expect(getActiveValue(points, 40)).toBe(38000);
    expect(getActiveValue(points, 100)).toBe(38000);
  });

  it('should handle unsorted change points', () => {
    const points = [
      { month: 40, amount: 38000 },
      { month: 0, amount: 33000 },
      { month: 20, amount: 35000 },
    ];
    expect(getActiveValue(points, 25)).toBe(35000);
  });

  it('should return fallback for month before any change point', () => {
    const points = [{ month: 5, amount: 10000 }];
    expect(getActiveValue(points, 3)).toBe(0);
    expect(getActiveValue(points, 5)).toBe(10000);
  });
});
