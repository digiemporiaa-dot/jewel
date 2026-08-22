'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploadField from '@/components/admin/ImageUploadField';
import type { Result } from './actions';

export type SeoDefaultsForm = {
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImageUrl: string;
  twitterHandle: string;
  indexingEnabled: boolean;
  robotsDisallow: string;
  localBusinessEnabled: boolean;
  businessType: string;
  priceRange: string;
  latitude: string;
  longitude: string;
  bingVerification: string;
  pinterestVerification: string;
};

/**
 * Site-wide SEO settings.
 *
 * No free-text HTML anywhere: every field is a value the code places into a
 * specific tag it constructs, the same rule the marketing tags and email
 * templates follow. Verification codes are stored as-is because Next renders
 * them into `<meta>` — never into a script.
 */
export default function SeoForm({
  defaults, save,
}: {
  defaults: SeoDefaultsForm;
  save: (fd: FormData) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [indexing, setIndexing] = useState(defaults.indexingEnabled);
  const [local, setLocal] = useState(defaults.localBusinessEnabled);

  function submit(fd: FormData) {
    setMessage(null);
    start(async () => {
      const res = await save(fd);
      setMessage(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.error ?? 'Could not save' });
      if (res.ok) router.refresh();
    });
  }

  return (
    <form action={submit} className="max-w-3xl space-y-5">
      <section className="space-y-3 border border-line bg-white p-4">
        <h2 className="font-heading text-lg">Indexing</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="indexingEnabled"
            checked={indexing}
            onChange={(e) => setIndexing(e.target.checked)}
          />
          <span>Allow search engines to index this site</span>
        </label>
        {!indexing && (
          <p className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>The whole site is hidden from search.</strong> Every page sends
            &ldquo;noindex&rdquo;, robots.txt disallows everything, and the sitemap is empty.
            Correct while you are still setting up — leave it off after launch and the shop will
            not appear on Google at all.
          </p>
        )}
        <L label="Extra paths to keep crawlers out of (one per line)">
          <textarea
            name="robotsDisallow"
            defaultValue={defaults.robotsDisallow}
            rows={3}
            placeholder="/preview&#10;/internal"
            className="c-inp font-mono text-xs"
          />
        </L>
        <p className="text-xs text-ink-soft">
          The bag, checkout, account and admin areas are always excluded — they are not part of
          this list and cannot be removed from it.
        </p>
      </section>

      <section className="space-y-3 border border-line bg-white p-4">
        <h2 className="font-heading text-lg">Titles and descriptions</h2>
        <L label="Title template">
          <input name="titleTemplate" defaultValue={defaults.titleTemplate} placeholder="%s · Maya Jewellers" className="c-inp" />
        </L>
        <p className="text-xs text-ink-soft">
          <code>%s</code> is replaced by each page&rsquo;s own title. Do not repeat your shop name
          in individual page titles — this already adds it.
        </p>
        <L label="Home page title">
          <input name="defaultTitle" defaultValue={defaults.defaultTitle} className="c-inp" />
        </L>
        <L label="Default description">
          <textarea name="defaultDescription" defaultValue={defaults.defaultDescription} rows={2} maxLength={320} className="c-inp" />
        </L>
        <p className="text-xs text-ink-soft">
          Used wherever a page has no description of its own. Without one, Google writes its own
          snippet from the page.
        </p>
        <L label="Social handle">
          <input name="twitterHandle" defaultValue={defaults.twitterHandle} placeholder="@mayajewellers" className="c-inp" />
        </L>
        <p className="text-xs text-ink-soft">
          Used to attribute the card when a link is shared on X. A profile URL works too.
        </p>
        <ImageUploadField
          name="defaultOgImageUrl"
          label="Default social image"
          prefix="seo"
          defaultValue={defaults.defaultOgImageUrl}
          hint="Shown when a link is shared and the page has no image of its own. 1200×630 works everywhere."
          altSourceNote="Social previews take their description from the page title."
        />
      </section>

      <section className="space-y-3 border border-line bg-white p-4">
        <h2 className="font-heading text-lg">Showroom listing</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="localBusinessEnabled"
            checked={local}
            onChange={(e) => setLocal(e.target.checked)}
          />
          <span>Publish shop details for local search</span>
        </label>
        <p className="text-xs text-ink-soft">
          Only switch this on if you have a real showroom at the address in Settings. Claiming a
          location you do not have can get the business dropped from local results altogether.
        </p>
        {local && (
          <div className="grid gap-3 sm:grid-cols-2">
            <L label="Business type"><input name="businessType" defaultValue={defaults.businessType} placeholder="JewelryStore" className="c-inp" /></L>
            <L label="Price range"><input name="priceRange" defaultValue={defaults.priceRange} placeholder="₹₹₹" className="c-inp" /></L>
            <L label="Latitude"><input name="latitude" defaultValue={defaults.latitude} inputMode="decimal" placeholder="28.6519" className="c-inp" /></L>
            <L label="Longitude"><input name="longitude" defaultValue={defaults.longitude} inputMode="decimal" placeholder="77.1909" className="c-inp" /></L>
          </div>
        )}
      </section>

      <section className="space-y-3 border border-line bg-white p-4">
        <h2 className="font-heading text-lg">Site verification</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Bing Webmaster Tools"><input name="bingVerification" defaultValue={defaults.bingVerification} className="c-inp" /></L>
          <L label="Pinterest"><input name="pinterestVerification" defaultValue={defaults.pinterestVerification} className="c-inp" /></L>
        </div>
        <p className="text-xs text-ink-soft">
          Paste only the verification code, not the whole meta tag. Google&rsquo;s lives under
          Marketing → Tracking &amp; Pixels.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary text-xs">
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {message && (
          <span className={message.ok ? 'text-xs text-ink-soft' : 'text-xs text-red-700'}>
            {message.text}
          </span>
        )}
      </div>

      <style>{`.c-inp{width:100%;border:1px solid var(--line);padding:.5rem .65rem;font-size:.875rem;outline:none;background:#fff}.c-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
