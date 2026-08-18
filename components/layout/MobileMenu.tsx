'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MenuIcon, CloseIcon } from '@/components/icons';
import type { NavLink } from '@/lib/navigation';

export default function MobileMenu({
  nav,
  brandName,
}: {
  nav: NavLink[];
  brandName: string;
}) {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="p-1.5 text-ink"
      >
        <MenuIcon width={22} height={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav className="absolute inset-y-0 left-0 w-[84%] max-w-[340px] bg-paper shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-5 h-16 border-b border-line">
              <span className="font-heading text-lg tracking-wide">{brandName}</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="p-1.5"
              >
                <CloseIcon width={22} height={22} />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto py-2">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block px-5 py-3.5 text-[0.95rem] border-b border-line/60 hover:text-brass"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="px-5 py-4 border-t border-line grid grid-cols-2 gap-3">
              <Link href="/my-account" onClick={() => setOpen(false)} className="btn-outline text-center">
                Account
              </Link>
              <Link href="/appointments" onClick={() => setOpen(false)} className="btn-primary text-center">
                Book Visit
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
