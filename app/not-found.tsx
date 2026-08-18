import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 text-4xl">This piece has slipped away</h1>
        <p className="mt-3 text-ink-soft">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className="btn-primary">
            Back home
          </Link>
          <Link href="/search" className="btn-outline">
            Search
          </Link>
        </div>
      </div>
    </div>
  );
}
