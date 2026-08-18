export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-40 bg-paper-2" />
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 border border-line bg-paper-2" />
        ))}
      </div>
    </div>
  );
}
