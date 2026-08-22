import 'server-only';
import { prisma } from '@/lib/prisma';
import { VIDEO_FRAME_HOSTS, fromStored, type VideoProvider } from '@/lib/video/parse';

/**
 * Which video hosts this shop actually needs in `frame-src`.
 *
 * Returned empty when nothing is embedded, which is the point: a permanently
 * widened `frame-src` is a permanently widened attack surface for the majority
 * of shops that never embed a video. The two hosts appear in the policy only
 * once something is there to frame.
 *
 * Read through the same 30-second middleware memo as the marketing-tag hosts,
 * so this runs at most twice a minute per isolate rather than per request.
 */
export async function videoFrameHosts(): Promise<string[]> {
  try {
    const [products, blocks] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null, videoUrl: { not: null } },
        select: { videoUrl: true },
        // The set of *providers* is what matters, not the set of videos. A
        // handful of rows is enough to discover both.
        take: 50,
      }),
      prisma.cmsBlock.findMany({
        where: { type: 'VIDEO', isActive: true },
        select: { data: true },
        take: 50,
      }),
    ]);

    const providers = new Set<VideoProvider>();

    for (const p of products) {
      const video = fromStored(p.videoUrl);
      if (video) providers.add(video.provider);
    }

    for (const block of blocks) {
      const data = block.data as { videoUrl?: unknown } | null;
      const video = typeof data?.videoUrl === 'string' ? fromStored(data.videoUrl) : null;
      if (video) providers.add(video.provider);
    }

    return [...providers].map((p) => VIDEO_FRAME_HOSTS[p]);
  } catch (e) {
    // Failing closed here means an embed does not render; failing open would
    // mean widening the policy on a database blip. The first is recoverable by
    // reloading, the second is a security decision made by accident.
    console.error('[video] could not determine frame hosts', e);
    return [];
  }
}
