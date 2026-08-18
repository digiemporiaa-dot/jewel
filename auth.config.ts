import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@prisma/client';

/**
 * Edge-safe base config. Contains NO Node-only imports (no Prisma, no bcrypt) so
 * it can run inside middleware. The Credentials provider that needs Prisma lives
 * in auth.ts. Route protection for /admin is handled by the `authorized` callback.
 */
export const authConfig = {
  // The app runs behind a reverse proxy (Coolify / VPS), so the forwarded host
  // must be trusted. Can also be set via AUTH_TRUST_HOST=true.
  trustHost: true,
  pages: {
    signIn: '/admin/login',
  },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { id: string; role: Role };
        token.id = u.id;
        token.role = u.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isAdminArea = pathname.startsWith('/admin');
      const isLoginPage = pathname === '/admin/login';
      if (isAdminArea && !isLoginPage) {
        return !!auth?.user; // must be signed in; fine-grained role checks happen server-side
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
