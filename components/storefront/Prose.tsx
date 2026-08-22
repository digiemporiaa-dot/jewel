import VideoEmbed from '@/components/storefront/VideoEmbed';
import { splitProse } from '@/lib/video/prose';
import { cn } from '@/lib/utils/cn';

/**
 * Written content — paragraphs, and a video wherever a line is nothing but its
 * address.
 *
 * Shared by the blog and by rich-text blocks so the two cannot disagree about
 * what a line means. The parsing is the same `parseVideo` used everywhere else;
 * an embed snippet pasted into a paragraph stays a paragraph, printed as the
 * text it is, and never becomes markup.
 */
export default function Prose({
  content, title, className, paragraphClassName,
}: {
  content: string;
  /** Used as the accessible name of any video in the text. */
  title: string;
  className?: string;
  paragraphClassName?: string;
}) {
  const blocks = splitProse(content);

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.kind === 'video' ? (
          <VideoEmbed
            key={i}
            video={block.video}
            title={`${title} — video`}
            className="my-6"
          />
        ) : (
          <p key={i} className={cn('leading-relaxed mb-4', paragraphClassName)}>
            {block.text}
          </p>
        )
      )}
    </div>
  );
}
