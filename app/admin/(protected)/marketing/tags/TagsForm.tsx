'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  TAG_FIELDS, CONSENT_MODES, CONSENT_MODE_LABELS,
  type TagFieldKey, type ConsentMode,
} from '@/lib/marketing/tags';
import { saveTagsAction, setCapiTokenAction } from './actions';

type Defaults = Record<TagFieldKey, string> & {
  consentMode: ConsentMode;
  consentBannerText: string;
  metaCapiEnabled: boolean;
};

const GROUPS: { title: string; note?: string; fields: TagFieldKey[] }[] = [
  {
    title: 'Google',
    note: 'If you use Tag Manager, configure GA4 and Ads inside the container rather than here.',
    fields: ['gtmId', 'ga4MeasurementId', 'googleAdsId', 'googleAdsLabel', 'googleSiteVerification'],
  },
  { title: 'Meta', fields: ['metaPixelId'] },
  { title: 'Behaviour analytics', fields: ['clarityProjectId', 'hotjarSiteId'] },
  { title: 'Other pixels', fields: ['pinterestTagId', 'tiktokPixelId', 'snapPixelId'] },
];

export default function TagsForm({
  defaults,
  capiTokenMask,
}: {
  defaults: Defaults;
  capiTokenMask: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : res.error ?? 'Failed' });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <form action={(fd) => run(() => saveTagsAction(fd), 'Saved — live within ~30 seconds')} className="space-y-5">
        {GROUPS.map((group) => (
          <section key={group.title} className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-heading text-lg">{group.title}</h2>
              {group.note && <p className="mt-0.5 text-xs text-ink-soft">{group.note}</p>}
            </div>
            <div className="p-4 grid sm:grid-cols-2 gap-4">
              {group.fields.map((key) => (
                <TagField key={key} name={key} defaultValue={defaults[key]} />
              ))}
            </div>
          </section>
        ))}

        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-heading text-lg">Consent</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              India&apos;s DPDP Act requires consent for this kind of tracking, and a Meta Pixel firing
              without it is a live risk for any EU visitor. Loosen this deliberately, not by default.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <label className="block max-w-xl">
              <span className="block mb-1 text-xs text-ink-soft">Consent mode</span>
              <select name="consentMode" defaultValue={defaults.consentMode} className="t-inp">
                {CONSENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>{CONSENT_MODE_LABELS[mode]}</option>
                ))}
              </select>
            </label>
            <label className="block max-w-xl">
              <span className="block mb-1 text-xs text-ink-soft">Banner text (optional)</span>
              <textarea
                name="consentBannerText"
                defaultValue={defaults.consentBannerText}
                rows={3}
                maxLength={400}
                placeholder="Leave blank to use the default wording."
                className="t-inp"
              />
            </label>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary text-xs">Save tracking settings</button>
          {msg && (
            <span className={msg.ok ? 'text-xs text-velvet' : 'text-xs text-red-700'}>{msg.text}</span>
          )}
        </div>
      </form>

      {/* Separate form: the token must only be written when deliberately re-entered. */}
      <section className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-heading text-lg">Meta Conversions API</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Sends purchases to Meta from our server, so conversions still register when a browser blocks
            the pixel. The token is stored server-side and never sent to the browser.
          </p>
        </div>
        <form
          action={(fd) => run(() => setCapiTokenAction(fd), 'Access token updated')}
          className="p-4 grid sm:grid-cols-[1fr_auto] gap-3 items-end"
        >
          <label className="block">
            <span className="block mb-1 text-xs text-ink-soft">
              Access token {capiTokenMask && <em className="not-italic text-ink">· currently {capiTokenMask}</em>}
            </span>
            <input
              type="password"
              name="metaCapiToken"
              autoComplete="off"
              placeholder={capiTokenMask ? 'Enter a new token to replace it' : 'Paste the access token'}
              className="t-inp"
            />
            <span className="mt-1 block text-xs text-ink-soft">
              Events Manager → your pixel → Settings → Conversions API.
              {capiTokenMask && ' Submitting this empty clears the token and turns CAPI off.'}
            </span>
          </label>
          <button type="submit" disabled={pending} className="btn-outline text-xs">Save token</button>
        </form>

        <form
          action={(fd) => run(() => saveTagsAction(fd), 'Saved')}
          className="border-t border-line px-4 py-3"
        >
          {/* The enable switch rides along with the rest of the settings, so the
              hidden fields keep the other values intact when only this changes. */}
          {(Object.keys(TAG_FIELDS) as TagFieldKey[]).map((key) => (
            <input key={key} type="hidden" name={key} value={defaults[key]} />
          ))}
          <input type="hidden" name="consentMode" value={defaults.consentMode} />
          <input type="hidden" name="consentBannerText" value={defaults.consentBannerText} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="metaCapiEnabled"
              defaultChecked={defaults.metaCapiEnabled}
              disabled={!capiTokenMask}
            />
            <span>
              Send purchases through the Conversions API
              {!capiTokenMask && <span className="text-ink-soft"> — add a token first</span>}
            </span>
          </label>
          <button type="submit" disabled={pending} className="btn-outline text-xs mt-3">Apply</button>
        </form>
      </section>

      <style>{`.t-inp{width:100%;border:1px solid var(--line);padding:.5rem .65rem;font-size:.875rem;outline:none;background:#fff}.t-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}

function TagField({ name, defaultValue }: { name: TagFieldKey; defaultValue: string }) {
  const field = TAG_FIELDS[name];
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-soft">{field.label}</span>
        {defaultValue === '' ? (
          <span className="text-[0.65rem] tracking-[0.06em] uppercase text-ink-soft">Off</span>
        ) : (
          <span className="text-[0.65rem] tracking-[0.06em] uppercase text-velvet">On</span>
        )}
      </span>
      <input name={name} defaultValue={defaultValue} placeholder={field.hint} className="t-inp" />
      <span className="mt-1 block text-xs text-ink-soft">
        Format <code className="bg-paper-2 px-1">{field.hint}</code> · {field.help}{' '}
        <a href={field.helpUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-brass">
          Open
        </a>
      </span>
    </label>
  );
}
