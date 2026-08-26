/**
 * Which contact details this shop actually verifies.
 *
 * Email is verified today; the phone is collected and stored **unverified**
 * until an SMS route is live, which is months away. Rather than leave that as a
 * fact somebody has to remember, it is a switch: `OTP_CHANNELS` lists the
 * channels a code may be sent on, and everything that could send one asks here
 * first.
 *
 * The default is email alone. A phone OTP that cannot be delivered is not a
 * degraded experience — it is a customer stuck waiting for a code that will
 * never arrive — so the channel has to be switched on deliberately once
 * delivery works, not left on hopefully.
 *
 * A sibling of `lib/otp.ts` rather than a file inside it: a `lib/otp/`
 * directory next to `lib/otp.ts` resolves ambiguously for `@/lib/otp`.
 *
 * Pure, so the parsing is testable without an environment.
 */

export const OTP_CHANNELS = ['email', 'phone'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

/** Email only. Phone joins it when `OTP_CHANNELS=email,phone` is set. */
export const DEFAULT_OTP_CHANNELS: readonly OtpChannel[] = ['email'];

export function parseOtpChannels(raw: string | undefined | null): OtpChannel[] {
  const listed = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OtpChannel => (OTP_CHANNELS as readonly string[]).includes(s));
  // An unset or unparseable value falls back rather than switching everything
  // off: a typo in an environment variable must not silently disable sign-in.
  return listed.length > 0 ? [...new Set(listed)] : [...DEFAULT_OTP_CHANNELS];
}

export function otpChannels(): OtpChannel[] {
  return parseOtpChannels(process.env.OTP_CHANNELS);
}

export function isOtpChannelEnabled(channel: OtpChannel): boolean {
  return otpChannels().includes(channel);
}
