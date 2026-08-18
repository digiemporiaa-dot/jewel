import type { Metadata } from 'next';
import { getStoreSettings } from '@/lib/store';
import LoginForm from './LoginForm';

export const metadata: Metadata = {
  title: 'Admin Sign In',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const store = await getStoreSettings();

  return (
    <div className="min-h-screen bg-paper-2 flex items-center justify-center px-4 font-body">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-heading text-2xl">{store.brandName}</p>
          <p className="eyebrow mt-1">Admin Console</p>
        </div>
        <div className="border border-line bg-paper p-6 sm:p-8">
          <h1 className="font-heading text-xl mb-6">Sign in</h1>
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-ink-soft">
          Authorized staff only. All actions are audited.
        </p>
      </div>
    </div>
  );
}
