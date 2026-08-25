/**
 * Admin `datetime-local` fields, in the timezone the shop actually works in.
 *
 * A `datetime-local` input submits a bare wall-clock string — `2026-08-25T14:26`
 * — with no offset on it. `new Date(thatString)` therefore parses it in *the
 * container's* timezone, which in production is UTC. A jeweller in Delhi setting
 * a campaign to start at 2:26 PM got one that started at 7:56 PM, and the
 * campaign they had just switched on simply did not appear.
 *
 * So every admin-entered wall clock is read as **IST** and stored as the UTC
 * instant it corresponds to, and every stored instant is rendered back into IST
 * for the input. What the shop types is what the shop sees.
 *
 * **Not** fixed by setting `TZ=Asia/Kolkata` on the container. That would move
 * every date comparison in the app at once, including the many already written
 * against UTC — the birthday match in `lib/campaigns`, the IST day buckets in
 * `lib/admin/date-range`, the UTC-midnight dates of birth — and would hide the
 * same bug elsewhere rather than fix it here.
 *
 * A fixed offset is correct rather than a shortcut: India has observed no
 * daylight saving since 1945 and has a single zone, so IST is UTC+05:30 on every
 * date this shop will ever schedule. `Intl` gymnastics would buy nothing and add
 * a way to be wrong.
 */

/** IST is UTC+05:30, always. */
export const IST_OFFSET_MINUTES = 330;

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** What a `datetime-local` input submits: `YYYY-MM-DDTHH:mm`, seconds optional. */
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Read an admin-entered wall clock as IST and return the instant it names.
 *
 * `2026-08-25T14:26` → 2026-08-25T08:56:00.000Z
 *
 * Returns null for anything that is not a real calendar moment, including the
 * shapes `Date` accepts and then quietly rolls over — 31 February becoming
 * 3 March would silently move a campaign by two days.
 */
export function istInputToUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = LOCAL_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, se] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = se ? Number(se) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Build the instant as if the wall clock were UTC, then step back by the
  // offset — the same wall clock in IST is that many minutes earlier in UTC.
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const instant = new Date(asIfUtc - IST_OFFSET_MS);

  // Reject a date `Date.UTC` rolled over rather than accepting the wrong day.
  const check = new Date(asIfUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return instant;
}

/**
 * Render a stored instant back into the value a `datetime-local` input expects,
 * in IST.
 *
 * 2026-08-25T08:56:00.000Z → `2026-08-25T14:26`
 *
 * The inverse of `istInputToUtc`, so opening a form shows the shop the same
 * clock time it typed.
 */
export function utcToIstInput(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  const shifted = new Date(value.getTime() + IST_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * Suffix for the label of any field that takes one of these.
 *
 * Shown because a bare "Starts" box gives a shop no way to know which clock it
 * is answering in — which is how this bug went unnoticed in the first place.
 */
export const IST_HINT = 'IST';

/** A stored instant, written out for a human. Used for read-only displays. */
export function formatIst(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  const shifted = new Date(value.getTime() + IST_OFFSET_MS);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} ${IST_HINT}`
  );
}
