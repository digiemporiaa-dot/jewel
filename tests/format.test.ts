import { describe, it, expect } from 'vitest';
import { formatCurrency, formatNumber, formatWeight } from '@/lib/utils/format';

describe('formatCurrency (Indian formatting)', () => {
  it('groups in the Indian system with a rupee symbol', () => {
    expect(formatCurrency(125000)).toBe('₹1,25,000');
    expect(formatCurrency('7150')).toBe('₹7,150');
  });

  it('never renders ₹0 / ₹NaN / ₹undefined for un-computable prices', () => {
    expect(formatCurrency(null)).toBe('Price on request');
    expect(formatCurrency(undefined)).toBe('Price on request');
    expect(formatCurrency('not-a-number')).toBe('Price on request');
  });

  it('respects a custom fallback', () => {
    expect(formatCurrency(null, { fallback: 'Please enquire' })).toBe('Please enquire');
  });
});

describe('formatNumber / formatWeight', () => {
  it('formats grams to three decimals', () => {
    expect(formatWeight('3.2')).toBe('3.200 g');
  });
  it('formats plain numbers with Indian grouping', () => {
    expect(formatNumber(1000000)).toBe('10,00,000');
  });
});
