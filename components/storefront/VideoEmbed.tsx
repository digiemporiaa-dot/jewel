'use client';

import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils/cn';
import { embedUrl, posterUrl, watchUrl, type ParsedVideo } from '@/lib/video/parse';

/**
 * A video, loaded only when somebody asks for it.
 *
 * Until the play button is pressed there is no iframe on the page at all — just
 * an image and a button. That matters more here than the usual performance
 * argument: an embed loaded on sight is a third-party frame running on every
 * product page view, and this shop's consent banner covers marketing tags, not
 * a player somebody dropped into a page. Nothing third-party executes until the
 * visitor has decided they want it.
 *
 * The iframe itself is built from `embedUrl`, never from anything an operator
 * typed. The admin field takes an address; the markup is ours.
 */
export default function VideoEmbed({
  video, title, poster, className,
}: {
  video: ParsedVideo;
  /** Used as the iframe's accessible name and the play button's label. */
  title: string;
  /** Operator-supplied still. Vimeo has no predictable thumbnail, so it matters there. */
  poster?: string | null;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const still = poster?.trim() || posterUrl(video);

  return (
    <div className={cn('relative aspect-video w-full overflow-hidden bg-ink/5', className)}>
      {playing ? (
        <iframe
          // Autoplay only because the visitor just pressed play — the click is
          // the consent, so the video starts without a second one.
          src={embedUrl(video, { autoplay: true })}
          title={title}
          // Exactly the permissions a player needs, and no more. Notably absent:
          // camera, microphone, geolocation, payment.
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer"
        >
          {still ? (
            <Image
              src={still}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 720px"
              className="object-cover"
            />
          ) : (
            // Vimeo serves no thumbnail at a predictable address, so rather than
            // reaching for a third-party proxy the shop never agreed to, the
            // placeholder is ours.
            <span className="absolute inset-0 bg-velvet/10" />
          )}

          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-ink/60 text-paper transition-transform group-hover:scale-110">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}

      {/* Reachable without JavaScript, and when the frame is blocked — by a
          corporate network, a privacy extension, or the CSP itself. */}
      <noscript>
        <a
          href={watchUrl(video)}
          target="_blank"
          rel="noreferrer"
          className="absolute inset-0 grid place-items-center bg-paper text-sm underline underline-offset-4"
        >
          Watch this video
        </a>
      </noscript>
    </div>
  );
}
