import 'server-only';
import type { SmsProvider } from '@/lib/sms/provider';
import { Msg91Provider } from '@/lib/sms/msg91';

let cached: SmsProvider | null = null;

/**
 * Resolve the configured gateway. SMS_PROVIDER selects the implementation so a
 * future client can switch gateways with an env change alone.
 */
export function getSmsProvider(): SmsProvider {
  if (!cached) {
    switch ((process.env.SMS_PROVIDER ?? 'msg91').toLowerCase()) {
      case 'msg91':
      default:
        cached = new Msg91Provider();
    }
  }
  return cached;
}

export type { SmsProvider, SmsResult } from '@/lib/sms/provider';
