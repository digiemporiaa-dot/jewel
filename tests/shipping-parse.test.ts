import { describe, it, expect, vi } from 'vitest';
import {
  readAwb, readCourier, readLabelUrl, readShipmentId, readStatus, readField,
  display, cleanMessage, DASH,
} from '@/lib/shipping/parse';

vi.mock('server-only', () => ({}));

// The shape this client was originally written against.
const NESTED = { response: { data: { awb_code: '14112366393092', courier_name: 'Xpressbees Surface', label_url: 'https://x/l.pdf' } } };
// The shape that arrived instead, and silently produced undefined.
const FLAT_DATA = { data: { awb_code: '14112366393092', courier_name: 'Xpressbees Surface' } };
const TOP_LEVEL = { awb: '14112366393092', courier: 'Xpressbees Surface' };
const ALREADY_ASSIGNED = { awb_assign_status: 1, response: { data: { awb_code: '14112366393092', courier_name: 'Xpressbees Surface' } } };
const NO_AWB = { awb_assign_status: 0, message: 'Courier not available for this pincode' };

describe('reading an AWB out of whatever shape arrived', () => {
  it('parses the documented nesting under response.data', () => {
    expect(readAwb(NESTED)).toBe('14112366393092');
    expect(readCourier(NESTED)).toBe('Xpressbees Surface');
    expect(readLabelUrl(NESTED)).toBe('https://x/l.pdf');
  });

  it('parses the same values nested only under data', () => {
    expect(readAwb(FLAT_DATA)).toBe('14112366393092');
    expect(readCourier(FLAT_DATA)).toBe('Xpressbees Surface');
  });

  it('parses them at the top level, under their short names', () => {
    expect(readAwb(TOP_LEVEL)).toBe('14112366393092');
    expect(readCourier(TOP_LEVEL)).toBe('Xpressbees Surface');
  });

  it('parses an already-assigned reply that carries a status alongside', () => {
    expect(readAwb(ALREADY_ASSIGNED)).toBe('14112366393092');
    expect(readStatus(ALREADY_ASSIGNED)).toBe('1');
  });

  it('unwraps a single-element array', () => {
    expect(readAwb({ data: [{ awb_code: 'AWB9' }] })).toBe('AWB9');
  });

  it('returns null — never a shape-shaped hole — when there is no AWB', () => {
    expect(readAwb(NO_AWB)).toBeNull();
    expect(readAwb({})).toBeNull();
    expect(readAwb(null)).toBeNull();
    expect(readAwb('a string')).toBeNull();
    expect(readAwb([])).toBeNull();
  });

  it('rejects the words that would otherwise be shown to staff verbatim', () => {
    // A JSON encoder upstream turning undefined into text is the same class of
    // bug this module exists to stop; it must not survive one more hop.
    expect(readAwb({ awb_code: 'undefined' })).toBeNull();
    expect(readAwb({ awb_code: 'null' })).toBeNull();
    expect(readCourier({ courier_name: '   ' })).toBeNull();
    expect(readCourier({ courier_name: 'N/A' })).toBeNull();
  });

  it('accepts a numeric id but not a zero one', () => {
    expect(readShipmentId({ shipment_id: 67890 })).toBe('67890');
    expect(readShipmentId({ shipment_id: 0 })).toBeNull();
  });

  it('prefers the nested answer over a generic field of the same name outside it', () => {
    const body = { status: 'OK', response: { data: { status: 'AWB ASSIGNED' } } };
    expect(readStatus(body)).toBe('AWB ASSIGNED');
  });

  it('reads a tracking envelope, which is how a lost AWB is recovered', () => {
    // The repair path reads a tracking reply to fix an assignment, so both
    // shapes have to be legible to the same reader.
    const tracking = { tracking_data: { shipment_track: [{ awb_code: '14112366393092', courier_name: 'Xpressbees Surface', current_status: 'READY TO SHIP' }] } };
    expect(readAwb(tracking)).toBe('14112366393092');
    expect(readCourier(tracking)).toBe('Xpressbees Surface');
    expect(readStatus(tracking)).toBe('READY TO SHIP');
  });

  it('reads any key list, in the order given', () => {
    expect(readField({ etd: 'later', edd: '2026-09-01' }, ['edd', 'etd'])).toBe('2026-09-01');
  });
});

describe('what the admin shows for a value we do not have', () => {
  it('renders a dash, never the string "undefined"', () => {
    for (const v of [null, undefined, '', '   ', 'undefined', 'null', 'N/A']) {
      expect(display(v)).toBe(DASH);
    }
  });

  it('renders a real value unchanged', () => {
    expect(display('14112366393092')).toBe('14112366393092');
    expect(display(67890)).toBe('67890');
  });

  it('scrubs the words out of timeline entries written before the fix', () => {
    // This exact string is in the database for the order that exposed the bug.
    expect(cleanMessage('AWB assigned: undefined (undefined)')).toBe(`AWB assigned: ${DASH} (${DASH})`);
    expect(cleanMessage('Shipment created with courier')).toBe('Shipment created with courier');
  });

  it('does not maul a legitimate word containing "null"', () => {
    expect(cleanMessage('Order nullified by staff')).toBe('Order nullified by staff');
  });
});
