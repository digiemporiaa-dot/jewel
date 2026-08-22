'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { TemplateVariable } from '@/lib/templates/render';
import type { Result, PreviewResult } from '../actions';

/**
 * The template editor.
 *
 * The body field is a plain textarea of HTML, and that is a deliberate limit: it
 * accepts formatting, links and images, and the server strips everything else on
 * save. There is no "paste your tracking code" field, no custom &lt;head&gt;
 * fragment, and no way for what an operator types to become executable — an
 * admin screen that injects operator-supplied markup into customer-facing pages
 * is how card skimmers get installed.
 *
 * The preview is rendered by the server through the same sanitiser the save
 * uses, then displayed in a sandboxed iframe, so a preview can neither lie about
 * what will be saved nor run anything in the admin's session.
 */

export type EditorProps = {
  templateKey: string;
  name: string;
  description: string;
  transactional: boolean;
  variables: TemplateVariable[];
  defaultSubject: string;
  defaultBodyHtml: string;
  current: { subject: string; body: string; bodyText: string; isActive: boolean; customised: boolean };
  smtpReady: boolean;
  save: (fd: FormData) => Promise<Result>;
  reset: (fd: FormData) => Promise<Result>;
  preview: (fd: FormData) => Promise<PreviewResult>;
  sendTest: (fd: FormData) => Promise<Result>;
};

export default function TemplateEditor(props: EditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subject, setSubject] = useState(props.current.subject);
  const [body, setBody] = useState(props.current.body);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function draft(): FormData {
    const fd = new FormData();
    fd.set('key', props.templateKey);
    fd.set('subject', subject);
    fd.set('body', body);
    return fd;
  }

  function onSave(fd: FormData) {
    setMessage(null);
    start(async () => {
      const res = await props.save(fd);
      if (!res.ok) return setMessage({ tone: 'error', text: res.error ?? 'Could not save' });
      setMessage({ tone: res.warning ? 'warn' : 'ok', text: res.warning ?? 'Saved.' });
      router.refresh();
    });
  }

  function onPreview() {
    setMessage(null);
    start(async () => {
      const res = await props.preview(draft());
      if (!res.ok) return setMessage({ tone: 'error', text: res.error });
      setPreview({ subject: res.subject, html: res.html });
    });
  }

  function onReset() {
    // Two steps, because this discards wording the shop may have spent time on.
    if (!confirm('Go back to the built-in wording? Your edits to this template will be lost.')) return;
    setMessage(null);
    start(async () => {
      const fd = new FormData();
      fd.set('key', props.templateKey);
      const res = await props.reset(fd);
      if (!res.ok) return setMessage({ tone: 'error', text: res.error ?? 'Could not reset' });
      setSubject(props.defaultSubject);
      setBody(props.defaultBodyHtml);
      setPreview(null);
      setMessage({ tone: 'ok', text: 'Back to the built-in wording.' });
      router.refresh();
    });
  }

  function onSendTest() {
    setMessage(null);
    start(async () => {
      const fd = new FormData();
      fd.set('key', props.templateKey);
      fd.set('to', testTo);
      const res = await props.sendTest(fd);
      setMessage(
        res.ok
          ? { tone: 'ok', text: `Test sent to ${testTo}. It uses the saved version, not unsaved edits.` }
          : { tone: 'error', text: res.error ?? 'Could not send' }
      );
    });
  }

  /** Drop a variable in at the cursor rather than making the operator type it. */
  function insert(name: string) {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <form action={onSave} className="space-y-4">
        <input type="hidden" name="key" value={props.templateKey} />

        <section className="border border-line bg-white p-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-soft">Subject line</span>
            <input
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              required
              className="w-full border border-line px-2.5 py-2 text-sm outline-none focus:border-brass"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-ink-soft">
              Body — text, links and images. Scripts and embeds are removed when you save.
            </span>
            <textarea
              ref={bodyRef}
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              required
              spellCheck={false}
              className="w-full border border-line px-2.5 py-2 font-mono text-xs leading-relaxed outline-none focus:border-brass"
            />
          </label>

          {!props.transactional && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={props.current.isActive} />
              <span>Use this wording</span>
              <span className="text-xs text-ink-soft">(off = the built-in wording is used)</span>
            </label>
          )}
          {props.transactional && (
            <>
              <input type="hidden" name="isActive" value="on" />
              <p className="text-xs text-ink-soft">
                This email is part of buying something, so it cannot be switched off — only
                reworded.
              </p>
            </>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary text-xs">Save</button>
          <button type="button" onClick={onPreview} disabled={pending} className="border border-line px-3 py-2 text-xs">
            Preview
          </button>
          {props.current.customised && (
            <button type="button" onClick={onReset} disabled={pending} className="border border-line px-3 py-2 text-xs text-ink-soft">
              Reset to default
            </button>
          )}
        </div>

        {message && (
          <p
            className={
              message.tone === 'error'
                ? 'border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800'
                : message.tone === 'warn'
                  ? 'border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
                  : 'border border-line bg-paper-2 px-3 py-2 text-sm text-ink-soft'
            }
          >
            {message.text}
          </p>
        )}

        {preview && (
          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-2">
              <p className="text-xs text-ink-soft">Subject</p>
              <p className="text-sm font-medium">{preview.subject || <em className="text-ink-soft">(empty)</em>}</p>
            </div>
            {/* Sandboxed with no allow-* flags: the preview can render, and
                nothing else. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[420px] w-full border-0 bg-white"
            />
          </section>
        )}

        <section className="border border-line bg-white p-4 space-y-2">
          <h2 className="font-heading text-base">Send yourself a test</h2>
          <p className="text-xs text-ink-soft">
            Uses the <strong>saved</strong> version with example data — save first if you have just
            edited something.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="min-w-[220px] flex-1 border border-line px-2.5 py-2 text-sm outline-none focus:border-brass"
            />
            <button
              type="button"
              onClick={onSendTest}
              disabled={pending || testTo.length === 0}
              className="border border-line px-3 py-2 text-xs disabled:opacity-50"
            >
              Send test
            </button>
          </div>
          {!props.smtpReady && (
            <p className="text-xs text-amber-900">
              No mail server is configured yet, so a test cannot be delivered.
            </p>
          )}
        </section>
      </form>

      <aside className="space-y-3">
        <section className="border border-line bg-white p-4">
          <h2 className="font-heading text-base">Variables</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Click to insert. Only these work in this template — anything else is rejected when you
            save.
          </p>
          <ul className="mt-3 space-y-2">
            {props.variables.map((v) => (
              <li key={v.name}>
                <button
                  type="button"
                  onClick={() => insert(v.name)}
                  disabled={v.html}
                  className="font-mono text-xs text-brass disabled:cursor-not-allowed disabled:text-ink-soft"
                >
                  {`{{${v.name}}}`}
                </button>
                <p className="text-xs text-ink-soft">{v.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border border-line bg-paper-2 p-4">
          <h2 className="font-heading text-base">What you can use</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Headings, bold and italic, lists, tables, links and images. Scripts, embedded videos and
            tracking code are removed on save — put tracking under Marketing → Tracking &amp;
            Pixels instead, where each provider is set up by its ID.
          </p>
        </section>
      </aside>
    </div>
  );
}
