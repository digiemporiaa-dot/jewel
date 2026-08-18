/**
 * Minimal RFC-4180-ish CSV parser and serializer (no dependency, per the brief's
 * minimal-deps rule). Handles quoted fields, embedded commas/newlines and escaped
 * double-quotes ("").
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Normalise line endings but preserve newlines inside quotes.
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Flush the trailing field/row (unless the input ended with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
}

/** Parse a CSV with a header row into an array of record objects. */
export function parseCsvRecords(input: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(input);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, records };
}

function escapeField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: string[], rows: Array<Record<string, string | number | null | undefined>>): string {
  const head = headers.map(escapeField).join(',');
  const body = rows
    .map((r) => headers.map((h) => escapeField(String(r[h] ?? ''))).join(','))
    .join('\n');
  return `${head}\n${body}`;
}
