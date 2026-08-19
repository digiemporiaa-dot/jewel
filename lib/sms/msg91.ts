import 'server-only';
import { type SmsProvider, type SmsResult, normalizeIndianMobile } from '@/lib/sms/provider';

const FLOW_URL = 'https://control.msg91.com/api/v5/flow/';
const TIMEOUT_MS = 10_000;

/**
 * MSG91 delivery via the Flow API. The OTP itself is generated and verified by
 * this application (lib/otp.ts) — MSG91 is only the transport, so MSG91's own
 * OTP endpoint is deliberately not used. The DLT-approved template must contain
 * a single variable named `otp`.
 */
export class Msg91Provider implements SmsProvider {
  readonly name = 'msg91';

  get dev(): boolean {
    return !(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
  }

  async sendOtp({ phone, code }: { phone: string; code: string }): Promise<SmsResult> {
    const mobile = normalizeIndianMobile(phone);
    if (!mobile) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
    if (this.dev) return { ok: false, error: 'SMS gateway is not configured' };

    try {
      const res = await fetch(FLOW_URL, {
        method: 'POST',
        headers: {
          authkey: process.env.MSG91_AUTH_KEY!,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          short_url: '0',
          realTimeResponse: '1',
          recipients: [{ mobiles: mobile, otp: code }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Never surface gateway internals to the shopper, and never log the code.
      if (!res.ok) {
        console.error(`[sms] msg91 http ${res.status}`);
        return { ok: false, error: 'Could not send the code. Please try again.' };
      }

      const body = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
      if (body?.type === 'error') {
        console.error(`[sms] msg91 rejected: ${body.message ?? 'unknown'}`);
        return { ok: false, error: 'Could not send the code. Please try again.' };
      }
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown';
      console.error(`[sms] msg91 request failed: ${reason}`);
      return { ok: false, error: 'Could not send the code. Please try again.' };
    }
  }
}
