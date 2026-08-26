import { cn } from '@/lib/utils/cn';

/**
 * The shop's name at the top of the page, and at the bottom of it.
 *
 * `StoreSetting.logoUrl` has been a column since the schema was written and
 * nothing rendered it. An operator could upload a logo, see it saved, and find
 * the site still showing the brand name as text — which is worse than having no
 * field at all, because they believe it is done and stop looking.
 *
 * Three things this has to get right, and none of them are obvious:
 *
 *  - **Height, never width.** A logo arrives at whatever aspect ratio the brand
 *    has. Constraining the width squashes a wide wordmark and balloons a tall
 *    crest; constraining the height matches how the wordmark it replaces was
 *    sized, and lets the width fall out of the artwork.
 *  - **The box is the same size either way.** The wrapper is given the height
 *    before anything loads, so a logo arriving late does not push the nav down
 *    the page. Vertical shift is the one that moves the rest of the document.
 *  - **The brand name does not stop being the brand name.** It is the `alt`
 *    text, so a logo is still readable to a screen reader and still says
 *    something if the image 404s, and it remains the fallback when there is no
 *    logo at all.
 */
export default function BrandMark({
  brandName, logoUrl, height, wordmarkClassName, className,
}: {
  brandName: string;
  logoUrl: string | null | undefined;
  /** Reserved height in pixels — the optical size of the wordmark it replaces. */
  height: number;
  /** Typography for the text fallback. */
  wordmarkClassName?: string;
  className?: string;
}) {
  const src = logoUrl?.trim();

  if (!src) {
    return (
      <span
        className={cn('flex items-center', className)}
        // Reserved on the fallback too, so a shop that adds a logo later gets
        // the same header height it had before rather than a jump.
        style={{ minHeight: height }}
      >
        <span className={wordmarkClassName}>{brandName}</span>
      </span>
    );
  }

  return (
    <span className={cn('flex items-center', className)} style={{ height }}>
      {/*
        A plain <img>, deliberately. `next/image` wants both dimensions or a
        sized parent, and the whole point here is that only one of them is
        known: the width belongs to the artwork. `object-contain` with `w-auto`
        keeps the aspect ratio whatever the operator uploads.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={brandName}
        style={{ height, width: 'auto' }}
        className="block max-w-full object-contain"
        // The logo is above the fold in the header and is part of what the
        // page is judged on in its first moment.
        loading="eager"
        decoding="async"
      />
    </span>
  );
}
