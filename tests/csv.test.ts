import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRecords, toCsv } from '@/lib/csv';

describe('CSV parser', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('name,tags\nRing,"gold,ring"')).toEqual([['name', 'tags'], ['Ring', 'gold,ring']]);
  });

  it('handles escaped double-quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([['a', 'b'], ['line1\nline2', 'x']]);
  });

  it('normalises CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('maps records against the header row', () => {
    const { headers, records } = parseCsvRecords('sku,name\nA1,Ring\nB2,Band');
    expect(headers).toEqual(['sku', 'name']);
    expect(records).toEqual([{ sku: 'A1', name: 'Ring' }, { sku: 'B2', name: 'Band' }]);
  });

  it('round-trips through toCsv with escaping', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'z"q' }]);
    const parsed = parseCsv(csv);
    expect(parsed[1]).toEqual(['x,y', 'z"q']);
  });
});
