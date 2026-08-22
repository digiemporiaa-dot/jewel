/**
 * Video embeds.
 *
 * **The rule: never accept a raw `<iframe>` or embed code.** An admin field that
 * takes markup and puts it on a customer-facing page is the same card-skimming
 * vector as a "paste your tracking script here" box, and a video field is where
 * somebody would think it is harmless. So an operator supplies a URL or an ID,
 * this validates it, and the iframe is constructed in code from a fixed
 * template.
 *
 * Pasting an embed snippet is *rejected*, not parsed out of. Extracting the src
 * would be friendlier and would teach exactly the wrong habit — the next field
 * to accept markup would be the one that mattered.
 *
 * Pure and dependency-free, so every accepted and rejected shape is testable.
 */

export type VideoProvider = 'youtube' | 'vimeo';

export type ParsedVideo = { provider: VideoProvider; id: string };

export type ParseResult =
  | { ok: true; video: ParsedVideo }
  | { ok: false; error: string };

/** YouTube IDs are exactly 11 characters of an URL-safe alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Vimeo IDs are numeric, currently 6–11 digits. */
const VIMEO_ID = /^\d{6,11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

const PASTE_URL_INSTEAD =
  'Paste the video’s web address, not its embed code — for example https://www.youtube.com/watch?v=… or https://vimeo.com/…';

/**
 * Turn what an operator typed into a provider and an ID.
 *
 * Accepts a full watch URL, a share URL, an embed URL, a Shorts URL, or a bare
 * ID. Rejects everything else, and says what to do instead.
 */
export function parseVideo(input: string): ParseResult {
  const value = input.trim();
  if (value === '') return { ok: false, error: 'Enter a video address.' };

  // Markup of any kind. Checked first so the message is about the actual
  // mistake rather than "that is not a valid URL".
  if (value.includes('<') || value.includes('>')) {
    return {
      ok: false,
      error: `Embed code is not accepted here. ${PASTE_URL_INSTEAD}`,
    };
  }

  // A bare ID. YouTube is checked first because a numeric-looking 11-character
  // string is far more likely to be a YouTube ID than a Vimeo one.
  if (YOUTUBE_ID.test(value)) return { ok: true, video: { provider: 'youtube', id: value } };
  if (VIMEO_ID.test(value)) return { ok: true, video: { provider: 'vimeo', id: value } };

  let url: URL;
  try {
    // A host with no scheme is a normal thing to paste.
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: `That is not a video address. ${PASTE_URL_INSTEAD}` };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `That is not a video address. ${PASTE_URL_INSTEAD}` };
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeIdFrom(url, host);
    return id
      ? { ok: true, video: { provider: 'youtube', id } }
      : { ok: false, error: 'That YouTube address does not contain a video id.' };
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = vimeoIdFrom(url);
    return id
      ? { ok: true, video: { provider: 'vimeo', id } }
      : { ok: false, error: 'That Vimeo address does not contain a video id.' };
  }

  return {
    ok: false,
    error: 'Only YouTube and Vimeo are supported. Upload the video to one of them and paste its address here.',
  };
}

function youtubeIdFrom(url: URL, host: string): string | null {
  // youtu.be/<id>
  if (host.endsWith('youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }

  // /watch?v=<id>
  const v = url.searchParams.get('v');
  if (v && YOUTUBE_ID.test(v)) return v;

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
    const id = parts[1];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }

  return null;
}

function vimeoIdFrom(url: URL): string | null {
  // The id is the last numeric path segment: /123456789,
  // /channels/staffpicks/123456789, /video/123456789 all end that way.
  const parts = url.pathname.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part && VIMEO_ID.test(part)) return part;
  }
  return null;
}

// ── Building what actually renders ───────────────────────────────────────────

/**
 * The embed URL, built here rather than stored.
 *
 * YouTube goes through `youtube-nocookie.com`, which does not set tracking
 * cookies until the visitor presses play — the shop should not be handing Google
 * a cookie on every product page view, and the consent banner covers marketing
 * tags, not an embed somebody dropped into a page.
 *
 * `rel=0` keeps the end-card suggestions to the same channel rather than
 * offering a competitor's video on the shop's own product page.
 */
export function embedUrl(video: ParsedVideo, options: { autoplay?: boolean } = {}): string {
  const autoplay = options.autoplay ? '1' : '0';

  if (video.provider === 'youtube') {
    const params = new URLSearchParams({
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
      autoplay,
    });
    return `https://www.youtube-nocookie.com/embed/${video.id}?${params}`;
  }

  const params = new URLSearchParams({ dnt: '1', autoplay, byline: '0', portrait: '0' });
  return `https://player.vimeo.com/video/${video.id}?${params}`;
}

/**
 * A still to show before the visitor presses play.
 *
 * YouTube serves one at a predictable address. Vimeo does not — its thumbnails
 * need an API call — so it returns null and the component shows its own
 * placeholder rather than pulling in a third-party thumbnail proxy the shop
 * never agreed to.
 */
export function posterUrl(video: ParsedVideo): string | null {
  if (video.provider === 'youtube') {
    return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  }
  return null;
}

/** Where to send someone whose browser will not run the embed. */
export function watchUrl(video: ParsedVideo): string {
  return video.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${video.id}`
    : `https://vimeo.com/${video.id}`;
}

/**
 * The hosts an embed needs in `frame-src`.
 *
 * Added to the policy only when a video is actually configured — see
 * `lib/video/csp.ts`. A permanently widened `frame-src` is a permanently
 * widened attack surface for the majority of shops that never embed anything.
 */
export const VIDEO_FRAME_HOSTS: Record<VideoProvider, string> = {
  youtube: 'https://www.youtube-nocookie.com',
  vimeo: 'https://player.vimeo.com',
};

/** Canonical stored form: `provider:id`, so nothing has to be re-parsed later. */
export function toStored(video: ParsedVideo): string {
  return `${video.provider}:${video.id}`;
}

/** Read the stored form back. Tolerates a bare URL from before this existed. */
export function fromStored(value: string | null | undefined): ParsedVideo | null {
  const stored = value?.trim();
  if (!stored) return null;

  const [provider, id] = stored.split(':', 2);
  if (provider === 'youtube' && id && YOUTUBE_ID.test(id)) return { provider, id };
  if (provider === 'vimeo' && id && VIMEO_ID.test(id)) return { provider, id };

  // Anything else is re-parsed, so a value stored by an older version — or by a
  // direct database edit — still has to pass validation before it renders.
  const parsed = parseVideo(stored);
  return parsed.ok ? parsed.video : null;
}
