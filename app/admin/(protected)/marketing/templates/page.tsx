import Link from 'next/link';
import { assertPermission } from '@/lib/auth/guard';
import { listTemplates } from '@/lib/templates';
import { isEmailConfigured } from '@/lib/email';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Email templates' };

export default async function TemplatesPage() {
  await assertPermission('settings.manage');
  const templates = await listTemplates();
  const smtpReady = isEmailConfigured();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-2xl">Email templates</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every email the shop sends. Each one already has working wording — edit it to make it
          yours, or leave it alone.
        </p>
      </header>

      {!smtpReady && (
        <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>No mail server is configured.</strong> You can write and preview templates, but
          nothing will actually be delivered — and the test-send button will say so — until
          <code className="mx-1">SMTP_HOST</code> and <code className="mx-1">SMTP_PORT</code> are
          set on the deployment.
        </p>
      )}

      <div className="border border-line bg-white divide-y divide-line">
        {templates.map(({ definition, customised, isActive, updatedAt }) => (
          <Link
            key={definition.key}
            href={`/admin/marketing/templates/${definition.key}`}
            className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-paper-2"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{definition.name}</span>
                {definition.transactional ? (
                  <span className="border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">
                    Transactional
                  </span>
                ) : (
                  <span className="border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">
                    Marketing
                  </span>
                )}
                {!isActive && (
                  <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900">
                    Using built-in wording
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-ink-soft">{definition.description}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-soft">
              {customised && isActive
                ? `Edited ${updatedAt ? updatedAt.toLocaleDateString('en-IN') : ''}`
                : 'Default'}
            </span>
          </Link>
        ))}
      </div>

      <p className="text-xs text-ink-soft">
        Templates hold text, links and images. Scripts, embeds and tracking code are not accepted
        here — tracking belongs under Marketing → Tracking &amp; Pixels, where each provider is
        configured by ID.
      </p>
    </div>
  );
}
