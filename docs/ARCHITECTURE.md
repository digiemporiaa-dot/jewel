# Architecture

## Principles

1. **Server-first.** Server Components by default; Server Actions for mutations.
   API routes only for webhooks, third-party callbacks, upload signatures and
   public/cron endpoints.
2. **Never trust the browser** for price, discount, payment amount, inventory,
   order status or ownership. All financial calculations are server-side.
3. **One pricing engine.** `lib/pricing` is the *only* place jewellery prices are
   calculated (Phase 2). No component computes prices independently.
4. **Nothing store-specific is hardcoded.** Brand name, contact, GST, thresholds,
   rate-lock duration, COD limits, etc. live in `StoreSetting` — the platform is
   resellable / white-label.
5. **Money is Decimal.** Prisma `Decimal` columns everywhere; never JS floats.

## Directory layout

```
app/
  (storefront)/          # customer site — Header/Footer layout
    layout.tsx  page.tsx  loading.tsx
  admin/
    login/               # public admin sign-in (outside the guarded shell)
    (protected)/         # guarded admin shell + role-filtered nav
      layout.tsx page.tsx <section>/page.tsx
  api/auth/[...nextauth]/ # Auth.js handlers
  error.tsx  not-found.tsx
  layout.tsx  globals.css # root layout + design tokens
components/
  layout/                # Header, Footer, RateTicker, MobileMenu
  admin/                 # AdminSidebar, StatCard, SectionPlaceholder
  icons.tsx              # dependency-free SVG icons
lib/
  prisma.ts              # PrismaClient singleton
  store.ts  rates.ts  catalog.ts  navigation.ts   # cached data access
  auth/                  # rbac.ts (permission matrix), guard.ts (server guards)
  admin/                 # nav.ts (role-filtered nav), dashboard.ts (stats)
  utils/                 # format.ts (formatCurrency…), cn.ts
  pricing/  payments/  shipping/  seo/  validations/  # filled in later phases
prisma/
  schema.prisma  seed.ts  migrations/
tests/                   # Vitest — rbac, formatting (pricing/orders in later phases)
docs/
```

## Authentication & authorization

- **Auth.js v5**, JWT session strategy. `auth.config.ts` is the edge-safe base
  (used by `middleware.ts`); `auth.ts` adds the Prisma+bcrypt Credentials provider.
- `middleware.ts` guards `/admin/*` for authentication only.
- **Authorization is enforced server-side** against the `lib/auth/rbac.ts` matrix
  via `requirePermission()` / `assertPermission()`. Menu visibility is filtered by
  the same matrix but is *never* the authorization boundary — every admin route
  and server action re-checks permission.

## Rendering & data

- `getStoreSettings`, `getCurrentRates`, `getTopCategories`, `getNavigation` are
  wrapped in React `cache` and defensively fall back if the DB is unavailable, so
  the shell always renders.
- Admin pages are `dynamic = 'force-dynamic'` (session + live data).

## Design system

Tokens live once as CSS variables in `app/globals.css` and are mapped into
Tailwind (`tailwind.config.ts`). Fonts load via `next/font`, which self-hosts
them at build time — `Playfair Display` for headings, `Montserrat` for body.
Components only ever name the *role* (`font-heading`, `font-body`, or the
`--font-heading` / `--font-body` variables), so changing a shop's typography is
`app/layout.tsx` and nothing else. Border-radius is capped at 2px per the brand. See
`docs/maya-jewellers-prototype.html` for the living visual reference.
