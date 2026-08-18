'use client';

import { useEffect } from 'react';

// Root error boundary. Never exposes stack traces or internal details to users.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logging happens where the error is thrown; here we log the
    // digest only (no sensitive payload) for client-side correlation.
    console.error('Unhandled error', error.digest);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-3 text-3xl">We hit an unexpected snag</h1>
        <p className="mt-3 text-ink-soft">
          Our team has been notified. Please try again in a moment.
        </p>
        <button onClick={reset} className="btn-primary mt-8">
          Try again
        </button>
      </div>
    </div>
  );
}
