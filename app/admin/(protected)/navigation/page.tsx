import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { getLinkOptions, checkPageLinks } from '@/lib/admin/nav-links';
import PageHeader from '@/components/admin/PageHeader';
import NavigationManager from './NavigationManager';

export const dynamic = 'force-dynamic';

export default async function NavigationPage({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string }>;
}) {
  await requirePermission('settings.manage');
  const sp = await searchParams;

  const menus = await prisma.navMenu.findMany({
    orderBy: { key: 'asc' },
    select: { id: true, key: true, label: true, _count: { select: { items: true } } },
  });

  if (menus.length === 0) {
    return (
      <div>
        <PageHeader title="Navigation" description="Header and footer menus." />
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No menus yet</p>
          <p className="mt-2 text-sm text-ink-soft">
            Run <code className="px-1 bg-paper-2">npm run db:bootstrap</code> to create the default
            header and footer menus. Until then the storefront falls back to its built-in navigation,
            so nothing is broken for shoppers.
          </p>
        </div>
      </div>
    );
  }

  const selected = menus.find((m) => m.key === sp.menu) ?? menus.find((m) => m.key === 'header') ?? menus[0]!;

  const items = await prisma.navItem.findMany({
    where: { menuId: selected.id },
    orderBy: [{ order: 'asc' }],
    select: { id: true, label: true, href: true, order: true, isActive: true, parentId: true },
  });

  const [linkOptions, issues] = await Promise.all([
    getLinkOptions(),
    checkPageLinks(items.map((i) => i.href)),
  ]);

  // Serialise the issue map for the client component.
  const issueList = [...issues.entries()].map(([href, issue]) => ({ href, ...issue }));

  return (
    <div>
      <PageHeader
        title="Navigation"
        description="Header and footer menus. Changes appear on the storefront immediately."
      />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Menus">
        {menus.map((m) => (
          <Link
            key={m.id}
            href={`/admin/navigation?menu=${m.key}`}
            className={
              m.id === selected.id
                ? 'border border-ink bg-ink text-paper px-3 py-1.5 text-xs tracking-[0.08em] uppercase'
                : 'border border-line bg-white px-3 py-1.5 text-xs tracking-[0.08em] uppercase hover:border-brass'
            }
          >
            {m.label}
            <span className="ml-1.5 opacity-60">{m._count.items}</span>
          </Link>
        ))}
      </nav>

      <NavigationManager
        menuId={selected.id}
        menuKey={selected.key}
        menuLabel={selected.label}
        items={items}
        linkOptions={linkOptions}
        issues={issueList}
      />
    </div>
  );
}
