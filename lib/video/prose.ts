import { parseVideo, type ParsedVideo } from '@/lib/video/parse';

/**
 * Video inside written content — a blog body or a rich-text block.
 *
 * Both are plain text, one paragraph per line, and deliberately so: there is no
 * HTML editor anywhere in this admin, because a free-form markup field on a site
 * that also processes checkout is the card-skimming vector the whole video
 * feature was built to avoid.
 *
 * So a video is **a line containing nothing but its address**. Nothing new is
 * accepted: the line goes through the same `parseVideo` as the product field and
 * the VIDEO block, an embed snippet is refused exactly as it is everywhere else,
 * and the iframe is still built in code. The only thing added here is *where* an
 * address may appear.
 *
 * Pure, so the same split can be tested and reused by the renderer and by the
 * CSP host scan.
 */

export type ProseBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'video'; video: ParsedVideo };

/**
 * Split written content into paragraphs and videos.
 *
 * A line only becomes a video when it is *entirely* an address — a paragraph
 * that mentions a link in passing stays a paragraph, and the reader gets the
 * sentence rather than an unexplained player dropped into the middle of it.
 */
export function splitProse(content: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    // Cheap gate before the parser: most lines are prose, and a sentence
    // containing a space is never a bare address.
    if (!line.includes(' ')) {
      const parsed = parseVideo(line);
      if (parsed.ok) {
        blocks.push({ kind: 'video', video: parsed.video });
        continue;
      }
    }

    blocks.push({ kind: 'paragraph', text: line });
  }

  return blocks;
}

/** Every video embedded in a piece of written content, for the CSP host scan. */
export function proseVideos(content: string | null | undefined): ParsedVideo[] {
  if (!content) return [];
  return splitProse(content)
    .filter((b): b is { kind: 'video'; video: ParsedVideo } => b.kind === 'video')
    .map((b) => b.video);
}
