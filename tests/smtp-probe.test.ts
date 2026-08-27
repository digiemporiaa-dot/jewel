import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const verify = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify, sendMail: vi.fn() }) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: { notification: { create: vi.fn() } } }));

import { probeSmtp, resetSmtpProbe, isEmailConfigured } from '@/lib/email';

/**
 * Whether the mail server will actually take a message.
 *
 * The dashboard used to answer a much weaker question — are two environment
 * variables set — and report "SMTP is configured" over a server rejecting every
 * login. Email is now the only channel a sign-in code travels on, so that is not
 * a cosmetic inaccuracy: it tells an operator the shop works while nobody can
 * get into it.
 */

beforeEach(() => {
  verify.mockReset();
  resetSmtpProbe();
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
});

afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
});

describe('probing the mail server', () => {
  it('says unconfigured when there is nothing to connect to', async () => {
    delete process.env.SMTP_HOST;
    expect(isEmailConfigured()).toBe(false);
    expect(await probeSmtp()).toEqual({ state: 'unconfigured' });
    // And never opens a connection to find that out.
    expect(verify).not.toHaveBeenCalled();
  });

  it('reports ok when the handshake and the credentials are accepted', async () => {
    verify.mockResolvedValue(true);
    expect(await probeSmtp()).toEqual({ state: 'ok' });
  });

  it('reports the rejection rather than calling it configured', async () => {
    // The Gmail app-password mistake, in the words Gmail actually uses.
    verify.mockRejectedValue(new Error('535-5.7.8 Username and Password not accepted'));
    const res = await probeSmtp();
    expect(res.state).toBe('failing');
    if (res.state === 'failing') expect(res.error).toMatch(/Username and Password not accepted/);
  });

  it('does not open a connection per dashboard refresh', async () => {
    // A handshake on every page view is a good way to get rate-limited by the
    // very server being checked.
    verify.mockResolvedValue(true);
    const t = 1_000_000;
    await probeSmtp(t);
    await probeSmtp(t + 1000);
    await probeSmtp(t + 60_000);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('re-checks once the cached answer is old', async () => {
    verify.mockResolvedValue(true);
    const t = 1_000_000;
    await probeSmtp(t);
    await probeSmtp(t + 6 * 60_000);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('can be forced, for an operator who has just changed something', async () => {
    verify.mockResolvedValue(true);
    await probeSmtp(1_000_000);
    resetSmtpProbe();
    await probeSmtp(1_000_100);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe('what the dashboard is told', () => {
  it('treats a rejecting server as critical, not as configured', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const health = readFileSync(join(__dirname, '..', 'lib/system/health.ts'), 'utf8');
    expect(health).toContain("smtp.state === 'failing'");
    expect(health).toContain("severity: 'critical'");
    // The remedy names the mistake that actually causes this with Gmail.
    expect(health).toMatch(/App Password/);
    expect(health).toMatch(/2-Step Verification/);
  });
});
