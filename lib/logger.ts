/**
 * Structured server logging (brief §68). Emits single-line JSON so a log
 * aggregator can parse it, and **redacts sensitive keys** so OTPs, passwords,
 * tokens, API keys and card data can never reach the logs.
 */

const REDACT_KEYS = [
  'password', 'passwordhash', 'otp', 'code', 'codehash', 'token', 'secret',
  'apikey', 'api_key', 'authorization', 'signature', 'card', 'cvv', 'pan',
  'accesskey', 'secretkey', 'cookie',
];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEYS.some((r) => k.includes(r));
}

/** Recursively redact sensitive values. Exported for testing. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitive(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => emit('info', event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit('warn', event, context),
  error: (event: string, context?: Record<string, unknown>) => emit('error', event, context),
};

/** Named events for the failure classes the brief calls out (§68). */
export const LogEvents = {
  pricingFailure: 'pricing.failure',
  paymentFailure: 'payment.failure',
  shippingFailure: 'shipping.failure',
  webhookFailure: 'webhook.failure',
  orderFailure: 'order.creation_failure',
  inventoryConflict: 'inventory.conflict',
  emailFailure: 'email.failure',
} as const;
