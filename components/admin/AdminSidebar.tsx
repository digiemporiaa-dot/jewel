'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { MenuIcon, CloseIcon } from '@/components/icons';
import { signOutAction } from '@/app/admin/actions';
import type { AdminNavSection } from '@/lib/admin/nav';

export default function AdminSidebar({
  sections,
  brandName,
  userName,
  roleLabel,
}: {
  sections: AdminNavSection[];
  brandName: string;
  userName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-velvet text-paper">
        <span className="font-heading text-lg">{brandName}</span>
        <button aria-label="Toggle admin menu" onClick={() => setOpen((v) => !v)}>
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <aside
        className={cn(
          'bg-velvet text-paper w-64 shrink-0 flex-col lg:flex lg:sticky lg:top-0 lg:h-screen',
          open ? 'flex fixed inset-0 z-40 w-full lg:w-64' : 'hidden'
        )}
      >
        <div className="hidden lg:block px-5 py-5 border-b border-paper/10">
          <p className="font-heading text-xl">{brandName}</p>
          <p className="text-[0.7rem] tracking-[0.14em] uppercase text-paper/50 mt-0.5">
            Admin Console
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-2 text-[0.65rem] tracking-[0.16em] uppercase text-paper/40">
                {section.title}
              </p>
              <ul className="mt-2 space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'block px-3 py-2 text-sm rounded-[2px] transition-colors',
                        isActive(item.href)
                          ? 'bg-paper/10 text-paper'
                          : 'text-paper/70 hover:text-paper hover:bg-paper/5'
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-paper/10">
          <p className="text-sm text-paper truncate">{userName}</p>
          <p className="text-[0.7rem] text-paper/50">{roleLabel}</p>
          <form action={signOutAction} className="mt-3">
            <button type="submit" className="w-full btn-outline border-paper/30 text-paper hover:text-brass hover:border-brass text-xs py-2">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
