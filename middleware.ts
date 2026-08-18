import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// Edge middleware guards the /admin area. It only checks authentication;
// fine-grained role authorization is enforced server-side in each admin route
// and server action (never trust the menu / the client).
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/admin/:path*'],
};
