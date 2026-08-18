// Skeleton loader for storefront routes (brief §52 — skeletons over spinners).
export default function Loading() {
  return (
    <div className="shell py-16 animate-pulse">
      <div className="h-8 w-48 bg-paper-2" />
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-square bg-paper-2" />
            <div className="mt-3 h-4 w-2/3 bg-paper-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
