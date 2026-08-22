import { describe, it, expect } from 'vitest';
import {
  parseVideo, embedUrl, posterUrl, watchUrl, toStored, fromStored,
  VIDEO_FRAME_HOSTS,
} from '@/lib/video/parse';
import { parseBlockData, BLOCK_LABELS } from '@/lib/cms/blocks';

const YT = 'dQw4w9WgXcQ';
const VM = '148751763';

describe('embed code is refused, not parsed', () => {
  /**
   * The rule this feature exists under. An admin field that takes markup and
   * puts it on a customer-facing page is the same vector as a "paste your
   * tracking script here" box — and a video field is where somebody would
   * assume it is harmless.
   */
  it('rejects a YouTube iframe snippet even though the src is valid', () => {
    const res = parseVideo(`<iframe src="https://www.youtube.com/embed/${YT}" allowfullscreen></iframe>`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Embed code is not accepted/);
  });

  it('rejects a Vimeo iframe snippet', () => {
    expect(parseVideo(`<iframe src="https://player.vimeo.com/video/${VM}"></iframe>`).ok).toBe(false);
  });

  it('rejects anything containing angle brackets', () => {
    expect(parseVideo(`<script>alert(1)</script>`).ok).toBe(false);
    expect(parseVideo(`https://youtu.be/${YT}"><script>`).ok).toBe(false);
  });

  it('tells the operator what to do instead', () => {
    const res = parseVideo('<iframe src="x"></iframe>');
    if (!res.ok) expect(res.error).toMatch(/web address/);
  });
});

describe('accepting a YouTube address', () => {
  it('reads a watch URL', () => {
    expect(parseVideo(`https://www.youtube.com/watch?v=${YT}`)).toEqual({
      ok: true, video: { provider: 'youtube', id: YT },
    });
  });

  it('reads a share URL', () => {
    expect(parseVideo(`https://youtu.be/${YT}`)).toMatchObject({ ok: true, video: { id: YT } });
  });

  it('reads an embed URL', () => {
    expect(parseVideo(`https://www.youtube.com/embed/${YT}`)).toMatchObject({ ok: true, video: { id: YT } });
  });

  it('reads a Shorts URL, which is how jewellery clips usually arrive', () => {
    expect(parseVideo(`https://www.youtube.com/shorts/${YT}`)).toMatchObject({ ok: true, video: { id: YT } });
  });

  it('reads the mobile and no-cookie hosts', () => {
    expect(parseVideo(`https://m.youtube.com/watch?v=${YT}`).ok).toBe(true);
    expect(parseVideo(`https://www.youtube-nocookie.com/embed/${YT}`).ok).toBe(true);
  });

  it('ignores extra parameters people copy along', () => {
    expect(parseVideo(`https://www.youtube.com/watch?v=${YT}&t=42s&list=PLxyz`))
      .toMatchObject({ ok: true, video: { id: YT } });
  });

  it('accepts a bare id', () => {
    expect(parseVideo(YT)).toMatchObject({ ok: true, video: { provider: 'youtube', id: YT } });
  });

  it('accepts a host with no scheme, which is a normal paste', () => {
    expect(parseVideo(`youtube.com/watch?v=${YT}`).ok).toBe(true);
  });

  it('refuses a YouTube URL with no video in it', () => {
    const res = parseVideo('https://www.youtube.com/@mayajewellers');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not contain a video id/);
  });

  it('refuses an id of the wrong length', () => {
    expect(parseVideo('https://www.youtube.com/watch?v=tooshort').ok).toBe(false);
  });
});

describe('accepting a Vimeo address', () => {
  it('reads a plain URL', () => {
    expect(parseVideo(`https://vimeo.com/${VM}`)).toEqual({
      ok: true, video: { provider: 'vimeo', id: VM },
    });
  });

  it('reads a player URL', () => {
    expect(parseVideo(`https://player.vimeo.com/video/${VM}`)).toMatchObject({ ok: true, video: { id: VM } });
  });

  it('reads a channel URL', () => {
    expect(parseVideo(`https://vimeo.com/channels/staffpicks/${VM}`)).toMatchObject({ ok: true, video: { id: VM } });
  });

  it('accepts a bare numeric id', () => {
    expect(parseVideo(VM)).toMatchObject({ ok: true, video: { provider: 'vimeo', id: VM } });
  });
});

describe('refusing everything else', () => {
  it('refuses another video host', () => {
    const res = parseVideo('https://dailymotion.com/video/x8abcde');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Only YouTube and Vimeo/);
  });

  it('refuses a lookalike hostname', () => {
    // `youtube.com.evil.example` is not YouTube.
    expect(parseVideo(`https://youtube.com.evil.example/watch?v=${YT}`).ok).toBe(false);
    expect(parseVideo(`https://notyoutube.com/watch?v=${YT}`).ok).toBe(false);
  });

  it('refuses a non-http scheme', () => {
    expect(parseVideo('javascript:alert(1)').ok).toBe(false);
    expect(parseVideo('data:text/html,<h1>x').ok).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(parseVideo('').ok).toBe(false);
    expect(parseVideo('   ').ok).toBe(false);
  });
});

describe('the URL the page actually loads', () => {
  it('uses youtube-nocookie, so no cookie is set before play', () => {
    // The consent banner covers marketing tags; it does not cover an embed
    // somebody dropped into a page, so the embed must not track by default.
    const url = embedUrl({ provider: 'youtube', id: YT });
    expect(url.startsWith('https://www.youtube-nocookie.com/embed/')).toBe(true);
    expect(url).not.toContain('//www.youtube.com');
  });

  it('keeps end-card suggestions on the same channel', () => {
    // Otherwise YouTube offers a competitor's video on the shop's product page.
    expect(embedUrl({ provider: 'youtube', id: YT })).toContain('rel=0');
  });

  it('asks Vimeo not to track', () => {
    expect(embedUrl({ provider: 'vimeo', id: VM })).toContain('dnt=1');
  });

  it('does not autoplay unless asked', () => {
    expect(embedUrl({ provider: 'youtube', id: YT })).toContain('autoplay=0');
    expect(embedUrl({ provider: 'youtube', id: YT }, { autoplay: true })).toContain('autoplay=1');
  });

  it('only ever builds a URL on the two allowed hosts', () => {
    for (const v of [{ provider: 'youtube', id: YT }, { provider: 'vimeo', id: VM }] as const) {
      const host = new URL(embedUrl(v)).origin;
      expect(Object.values(VIDEO_FRAME_HOSTS)).toContain(host);
    }
  });
});

describe('the still shown before play', () => {
  it('comes from YouTube at a predictable address', () => {
    expect(posterUrl({ provider: 'youtube', id: YT })).toBe(`https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
  });

  it('is absent for Vimeo rather than pulled from a thumbnail proxy', () => {
    // Vimeo thumbnails need an API call. Reaching for a third-party proxy would
    // add a host the shop never agreed to for the sake of one image.
    expect(posterUrl({ provider: 'vimeo', id: VM })).toBeNull();
  });
});

describe('the fallback link', () => {
  it('sends a visitor to the real page when the embed cannot run', () => {
    expect(watchUrl({ provider: 'youtube', id: YT })).toBe(`https://www.youtube.com/watch?v=${YT}`);
    expect(watchUrl({ provider: 'vimeo', id: VM })).toBe(`https://vimeo.com/${VM}`);
  });
});

describe('storage', () => {
  it('round-trips', () => {
    for (const v of [{ provider: 'youtube', id: YT }, { provider: 'vimeo', id: VM }] as const) {
      expect(fromStored(toStored(v))).toEqual(v);
    }
  });

  it('re-validates a value it did not write', () => {
    // A row edited directly in the database, or written by an older version,
    // still has to pass validation before anything renders it.
    expect(fromStored(`https://youtu.be/${YT}`)).toEqual({ provider: 'youtube', id: YT });
    expect(fromStored('youtube:not-an-id')).toBeNull();
    expect(fromStored('<iframe src="x">')).toBeNull();
    expect(fromStored('https://evil.example/x')).toBeNull();
  });

  it('reads nothing as nothing', () => {
    expect(fromStored(null)).toBeNull();
    expect(fromStored('')).toBeNull();
    expect(fromStored('   ')).toBeNull();
  });
});

// ── The CMS block ────────────────────────────────────────────────────────────

describe('the video block schema', () => {
  const parse = (videoUrl: string) => parseBlockData('VIDEO', { heading: '', caption: '', videoUrl, posterUrl: '' });

  it('refuses embed code, with the same message as the product field', () => {
    const res = parse(`<iframe src="https://www.youtube.com/embed/${YT}"></iframe>`);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toMatch(/Embed code is not accepted/);
  });

  it('stores the canonical form, not the URL the operator pasted', () => {
    // The renderer must never have to re-parse a URL, and nothing but a
    // validated id should reach the page.
    const res = parse(`https://www.youtube.com/watch?v=${YT}&t=30s`);
    expect(res.success).toBe(true);
    if (res.success) expect((res.data as { videoUrl: string }).videoUrl).toBe(`youtube:${YT}`);
  });

  it('allows an empty block, so one can be added and filled in later', () => {
    expect(parse('').success).toBe(true);
  });

  it('refuses a host that is not YouTube or Vimeo', () => {
    expect(parse('https://evil.example/video').success).toBe(false);
  });

  it('is offered to operators as a block type', () => {
    expect(BLOCK_LABELS.VIDEO).toBe('Video');
  });
});
