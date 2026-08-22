import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertPermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { templateDefinition } from '@/lib/templates/registry';
import { isEmailConfigured } from '@/lib/email';
import TemplateEditor from './TemplateEditor';
import { saveTemplateAction, resetTemplateAction, previewTemplateAction, sendTestAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  await assertPermission('settings.manage');
  const { key } = await params;

  const definition = templateDefinition(key);
  if (!definition) notFound();

  const row = await prisma.messageTemplate.findUnique({
    where: { key: definition.key },
    select: { subject: true, body: true, bodyText: true, isActive: true },
  });
  const customised = Boolean(row && row.body.trim().length > 0);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin/marketing/templates" className="text-xs text-ink-soft hover:text-ink">
          ← All templates
        </Link>
        <h1 className="mt-1 font-heading text-2xl">{definition.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">{definition.description}</p>
      </header>

      <TemplateEditor
        templateKey={definition.key}
        name={definition.name}
        description={definition.description}
        transactional={definition.transactional}
        variables={definition.variables}
        defaultSubject={definition.defaultSubject}
        defaultBodyHtml={definition.defaultBodyHtml}
        current={{
          // An un-customised template opens on the built-in copy, so the
          // operator edits real wording rather than starting from a blank box.
          subject: customised && row?.subject ? row.subject : definition.defaultSubject,
          body: customised && row ? row.body : definition.defaultBodyHtml,
          bodyText: row?.bodyText ?? '',
          isActive: row?.isActive ?? true,
          customised,
        }}
        smtpReady={isEmailConfigured()}
        save={saveTemplateAction}
        reset={resetTemplateAction}
        preview={previewTemplateAction}
        sendTest={sendTestAction}
      />
    </div>
  );
}
