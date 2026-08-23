import { PrismaClient, PublishStatus, type Prisma } from '@prisma/client';
import { HOME_SLUG, HOME_PAGE_TITLE, HOME_BLUEPRINT } from '../lib/cms/home';
import { resolveBlockStyle } from '../lib/cms/style';

/**
 * Idempotent content bootstrap: navigation menus and the policy pages the footer
 * links to.
 *
 * Deliberately separate from `seed.ts`, which resets the database and is only
 * ever safe on a fresh install. This runs against a live store: it creates what
 * is missing and touches nothing that already exists, so it can be re-run after
 * every deploy without risking a shop's real data.
 *
 * Run standalone with `npm run db:bootstrap`.
 */

const MENUS: { key: string; label: string; items: { label: string; href: string }[] }[] = [
  {
    key: 'header',
    label: 'Header',
    items: [
      { label: 'New Arrivals', href: '/c/new-arrivals' },
      { label: 'Gold', href: '/c/gold' },
      { label: 'Diamond', href: '/c/diamond' },
      { label: 'Silver', href: '/c/silver' },
      { label: 'Rings', href: '/c/rings' },
      { label: 'Earrings', href: '/c/earrings' },
      { label: 'Necklaces', href: '/c/necklaces' },
      { label: 'Bracelets', href: '/c/bracelets' },
      { label: 'Bangles', href: '/c/bangles' },
      { label: 'Mangalsutra', href: '/c/mangalsutra' },
      { label: 'Wedding', href: '/c/wedding' },
      { label: 'Gifting', href: '/c/gifting' },
      { label: 'Collections', href: '/collections' },
    ],
  },
  {
    key: 'footer-shop',
    label: 'Footer — Shop',
    items: [
      { label: 'New Arrivals', href: '/c/new-arrivals' },
      { label: 'Gold', href: '/c/gold' },
      { label: 'Diamond', href: '/c/diamond' },
      { label: 'Silver', href: '/c/silver' },
      { label: 'Collections', href: '/collections' },
    ],
  },
  {
    key: 'footer-help',
    label: 'Footer — Help',
    items: [
      { label: 'Track Order', href: '/track' },
      { label: 'Book Appointment', href: '/appointments' },
      { label: 'Shipping & Returns', href: '/pages/shipping-returns' },
      { label: 'Jewellery Care', href: '/pages/jewellery-care' },
      { label: 'Contact Us', href: '/pages/contact' },
    ],
  },
  {
    key: 'footer-about',
    label: 'Footer — About',
    items: [
      { label: 'Our Story', href: '/pages/about' },
      { label: 'BIS Hallmark', href: '/pages/hallmark' },
      { label: 'Certifications', href: '/pages/certifications' },
      { label: 'Blog', href: '/blog' },
    ],
  },
  {
    key: 'footer-legal',
    label: 'Footer — Legal',
    items: [
      { label: 'Privacy', href: '/pages/privacy' },
      { label: 'Terms', href: '/pages/terms' },
    ],
  },
];

/**
 * The pages the footer already links to but which were never created — every one
 * of them a live 404 until now.
 *
 * They are seeded as DRAFT on purpose. Publishing shipping, refund or privacy
 * text the jeweller has not read would be worse than a missing page: it is a
 * commitment made on their behalf. The admin navigation screen flags them as
 * unpublished until someone fills them in.
 */
const POLICY_PAGES: { slug: string; title: string; heading: string; body: string }[] = [
  {
    slug: 'shipping-returns',
    title: 'Shipping & Returns',
    heading: 'Shipping & Returns',
    body: [
      'Replace this placeholder with your real shipping and returns policy.',
      'Cover: dispatch time, courier partners, delivery estimates, shipping charges and free-shipping threshold, insurance, and what happens if a parcel is lost or damaged.',
      'For returns: the window in days, the condition items must be in, who pays return postage, how refunds are issued and how long they take, and any items that cannot be returned (custom or made-to-order pieces, for example).',
    ].join('\n'),
  },
  {
    slug: 'jewellery-care',
    title: 'Jewellery Care',
    heading: 'Caring for your jewellery',
    body: [
      'Replace this placeholder with your care guidance.',
      'Typical sections: daily wear and storage, cleaning gold, silver and gold-plated pieces, what to keep away from perfume and chlorine, when to bring a piece in for professional polishing, and how your re-plating or servicing works.',
    ].join('\n'),
  },
  {
    slug: 'contact',
    title: 'Contact Us',
    heading: 'Get in touch',
    body: [
      'Replace this placeholder with your contact details.',
      'Include: showroom address, phone number, WhatsApp, email, opening hours and a map or directions. A named contact for order queries helps customers reach the right person quickly.',
    ].join('\n'),
  },
  {
    slug: 'hallmark',
    title: 'BIS Hallmark',
    heading: 'BIS Hallmarking',
    body: [
      'Replace this placeholder with your hallmarking explanation.',
      'Explain what the BIS hallmark certifies, how to read the marks on a piece, which purities you stock, and your HUID registration. Customers use this page to check they are buying genuine hallmarked gold.',
    ].join('\n'),
  },
  {
    slug: 'certifications',
    title: 'Certifications',
    heading: 'Our certifications',
    body: [
      'Replace this placeholder with your certification details.',
      'Cover the diamond grading labs you work with, what a certificate includes, how a certificate is supplied with an order, and any additional guarantees or buy-back terms you offer.',
    ].join('\n'),
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    heading: 'Privacy Policy',
    body: [
      'Replace this placeholder with your privacy policy. Have it reviewed before publishing — this is a legal document.',
      'It should state: what personal data you collect, why, how long you keep it, who you share it with (payment and shipping partners), how customers can request deletion, and how to contact you about data.',
    ].join('\n'),
  },
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    heading: 'Terms & Conditions',
    body: [
      'Replace this placeholder with your terms of sale. Have them reviewed before publishing — this is a legal document.',
      'Typical coverage: order acceptance, how dynamic pricing and the rate lock work, payment terms and advances on made-to-order pieces, cancellation, warranty, and the governing jurisdiction.',
    ].join('\n'),
  },
];

export async function bootstrapNavigation(prisma: PrismaClient): Promise<{ menusCreated: number; itemsCreated: number }> {
  let menusCreated = 0;
  let itemsCreated = 0;

  for (const spec of MENUS) {
    const existing = await prisma.navMenu.findUnique({
      where: { key: spec.key },
      select: { id: true, _count: { select: { items: true } } },
    });

    const menu = existing
      ? { id: existing.id }
      : (menusCreated++, await prisma.navMenu.create({ data: { key: spec.key, label: spec.label } }));

    // Only populate an empty menu. A shop that has curated its own navigation
    // must never have it overwritten by a redeploy.
    const itemCount = existing?._count.items ?? 0;
    if (itemCount > 0) continue;

    await prisma.navItem.createMany({
      data: spec.items.map((item, i) => ({ menuId: menu.id, label: item.label, href: item.href, order: i })),
    });
    itemsCreated += spec.items.length;
  }

  return { menusCreated, itemsCreated };
}

export async function bootstrapPolicyPages(prisma: PrismaClient): Promise<{ created: number }> {
  let created = 0;

  for (const spec of POLICY_PAGES) {
    const exists = await prisma.cmsPage.findUnique({ where: { slug: spec.slug }, select: { id: true } });
    if (exists) continue;

    const page = await prisma.cmsPage.create({
      data: {
        slug: spec.slug,
        title: spec.title,
        status: PublishStatus.DRAFT,
        seoTitle: spec.title,
      },
    });
    await prisma.cmsBlock.create({
      data: {
        pageId: page.id,
        type: 'RICH_TEXT',
        order: 0,
        data: { heading: spec.heading, body: spec.body, align: 'left' } as Prisma.InputJsonValue,
      },
    });
    created++;
  }

  return { created };
}

/**
 * Give the shop an editable homepage.
 *
 * `/` renders the blueprint in lib/cms/home.ts whether or not this has run, so
 * this is not what puts a homepage on the site — it is what puts one in the
 * admin. Creating it here means a jeweller finds the hero image and headline as
 * form fields the first time they look, instead of finding nothing and
 * concluding the homepage is off-limits.
 *
 * Idempotent, like everything else in this file: an existing `home` page is left
 * exactly as its owner edited it.
 */
export async function bootstrapHomepage(prisma: PrismaClient): Promise<{ created: boolean }> {
  const exists = await prisma.cmsPage.findUnique({ where: { slug: HOME_SLUG }, select: { id: true } });
  if (exists) return { created: false };

  await prisma.cmsPage.create({
    data: {
      slug: HOME_SLUG,
      title: HOME_PAGE_TITLE,
      status: PublishStatus.PUBLISHED,
      publishedAt: new Date(),
      blocks: {
        create: HOME_BLUEPRINT.map((block, order) => ({
          type: block.type,
          order,
          data: { ...block.data, style: resolveBlockStyle(block.type, block.data) } as Prisma.InputJsonValue,
        })),
      },
    },
  });
  return { created: true };
}

export async function bootstrapContent(prisma: PrismaClient): Promise<void> {
  const nav = await bootstrapNavigation(prisma);
  const pages = await bootstrapPolicyPages(prisma);
  const home = await bootstrapHomepage(prisma);
  console.info(
    `[bootstrap] menus created: ${nav.menusCreated}, nav items created: ${nav.itemsCreated}, ` +
    `policy pages created: ${pages.created}, homepage created: ${home.created}`
  );
}

// Standalone entry point: `npm run db:bootstrap`.
if (process.argv[1] && process.argv[1].includes('bootstrap')) {
  const prisma = new PrismaClient();
  bootstrapContent(prisma)
    .catch((e) => {
      console.error('[bootstrap] failed', e);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
