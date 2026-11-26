import { describe, expect, it } from 'vitest';
import { compareDecimalStrings } from './compare-decimal-strings';

describe('compareDecimalStrings', () => {
  it('compares fractional values exactly without floating-point conversion', () => {
    expect(compareDecimalStrings({ left: '1.10', right: '1.2' })).toBe(-1);
    expect(compareDecimalStrings({ left: '12.00', right: '12' })).toBe(0);
    expect(compareDecimalStrings({ left: '12.01', right: '12' })).toBe(1);
  });

  it('compares integers beyond the safe-number range exactly', () => {
    expect(compareDecimalStrings({
      left: '900719925474099300000.01',
      right: '900719925474099300000.00',
    })).toBe(1);
  });
});
