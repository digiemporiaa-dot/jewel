'use client';

import { useState } from 'react';
import ImageUploadField from '@/components/admin/ImageUploadField';
import { cn } from '@/lib/utils/cn';

/**
 * The SEO fields on an entity's edit page.
 *
 * `ogImageUrl`, `canonicalUrl` and `noIndex` have existed on Product, Category,
 * Collection, CmsPage and BlogPost since the columns were added, and until now
 * no form could set any of them — the schema supported per-page social images
 * and canonical overrides that nobody could reach.
 *
 * One component for all five, because the fields are the same and five copies
 * would drift. Rendered as a `<fieldset>` inside whatever form already exists,
 * so it submits with the rest of that form and needs no separate save.
 */

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;
/** What every social network crops to. Anything smaller is upscaled and soft. */
const OG_MIN_WIDTH = 1200;
const OG_MIN_HEIGHT = 630;

export type SeoDefaults = {
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
};

export default function SeoPanel({
  defaults = {},
  /** Upload folder for the social image. */
  prefix,
  /** The public path this entity lives at, for the canonical hint. */
  publicPath,
  /** Whether the entity is currently visible to the public, for the noIndex warning. */
  isPublished = true,
}: {
  defaults?: SeoDefaults;
  prefix: 'products' | 'categories' | 'collections' | 'cms' | 'blog';
  publicPath?: string;
  isPublished?: boolean;
}) {
  const [title, setTitle] = useState(defaults.seoTitle ?? '');
  const [description, setDescription] = useState(defaults.seoDescription ?? '');
  const [canonical, setCanonical] = useState(defaults.canonicalUrl ?? '');
  const [noIndex, setNoIndex] = useState(Boolean(defaults.noIndex));
  const [ogImage, setOgImage] = useState(defaults.ogImageUrl ?? '');
  const [ogSize, setOgSize] = useState<{ w: number; h: number } | null>(null);

  // An off-site canonical tells Google this page is a copy of somebody else's.
  // It is occasionally deliberate and far more often a paste error, and the
  // cost is the page dropping out of results with nothing on screen to explain
  // why.
  const offSite = canonical.trim() !== '' && /^https?:\/\//i.test(canonical) && !canonical.includes(hostHint());
  const ogTooSmall = ogSize !== null && (ogSize.w < OG_MIN_WIDTH || ogSize.h < OG_MIN_HEIGHT);

  return (
    <fieldset className="border border-line p-4 space-y-4">
      <legend className="px-1 text-xs tracking-[0.1em] uppercase text-ink-soft">Search &amp; social</legend>

      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-xs text-ink-soft">
          <span>Page title</span>
          <span className={cn(title.length > TITLE_LIMIT && 'text-red-700')}>
            {title.length}/{TITLE_LIMIT}
          </span>
        </span>
        <input
          name="seoTitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Leave blank to use the name"
          className="s-panel-inp"
        />
        {title.length > TITLE_LIMIT && (
          <span className="mt-1 block text-xs text-red-700">
            Google shows about {TITLE_LIMIT} characters — the end will be cut off.
          </span>
        )}
        <span className="mt-1 block text-xs text-ink-soft">
          The brand name is added automatically by the title template. Do not type it here.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-xs text-ink-soft">
          <span>Meta description</span>
          <span className={cn(description.length > DESCRIPTION_LIMIT && 'text-red-700')}>
            {description.length}/{DESCRIPTION_LIMIT}
          </span>
        </span>
        <textarea
          name="seoDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={400}
          className="s-panel-inp"
        />
        {description.trim() === '' && (
          <span className="mt-1 block text-xs text-ink-soft">
            Without one, Google writes its own snippet from the page, and it is rarely the one you would choose.
          </span>
        )}
      </label>

      <div>
        <ImageUploadField
          name="ogImageUrl"
          label="Social image"
          prefix={prefix}
          value={ogImage}
          onChange={(v) => { setOgImage(v); setOgSize(null); }}
          hint={`Shown when the link is shared on WhatsApp, Instagram or Facebook. ${OG_MIN_WIDTH}×${OG_MIN_HEIGHT} or larger.`}
          altSourceNote="Social previews take their description from the page title."
        />
        {/* Measured in the browser from the preview that is already loading —
            no server round trip, and it catches the common case of a 400px
            product thumbnail being reused as a social card. */}
        {ogImage.trim() !== '' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ogImage}
            alt=""
            className="hidden"
            onLoad={(e) => {
              const img = e.currentTarget;
              setOgSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
        )}
        {ogTooSmall && (
          <p className="mt-1 text-xs text-red-700">
            That image is {ogSize!.w}×{ogSize!.h}. Below {OG_MIN_WIDTH}×{OG_MIN_HEIGHT} it is upscaled
            and looks soft in the preview card.
          </p>
        )}
        {ogSize && !ogTooSmall && (
          <p className="mt-1 text-xs text-ink-soft">{ogSize.w}×{ogSize.h} — good.</p>
        )}
      </div>

      <label className="block">
        <span className="block mb-1 text-xs text-ink-soft">Canonical URL (optional)</span>
        <input
          name="canonicalUrl"
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          maxLength={500}
          placeholder={publicPath ? `Defaults to ${publicPath}` : 'Defaults to this page'}
          className={cn('s-panel-inp', offSite && 'border-red-400')}
        />
        {offSite ? (
          <span className="mt-1 block text-xs text-red-700">
            This points at another site, which tells Google this page is a copy of that one. Usually a
            paste error — and the page drops out of results with nothing on screen to explain it.
          </span>
        ) : (
          <span className="mt-1 block text-xs text-ink-soft">
            Only set this when the same content lives at another address on this site.
          </span>
        )}
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="noIndex"
          checked={noIndex}
          onChange={(e) => setNoIndex(e.target.checked)}
          className="mt-1"
        />
        <span>
          Hide from search results
          {noIndex && isPublished && (
            <span className="block text-xs text-red-700">
              This page is live but will not appear in Google. Silent deindexing costs months of
              traffic before anybody notices.
            </span>
          )}
        </span>
      </label>

      <style>{`.s-panel-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.s-panel-inp:focus{border-color:var(--brass)}`}</style>
    </fieldset>
  );
}

/**
 * The site's own host, read from the browser.
 *
 * A "same site" check needs to know what this site is, and the admin already
 * runs on it — no need to thread `SITE_URL` through five forms to learn
 * something `location` already knows.
 */
function hostHint(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname;
}
