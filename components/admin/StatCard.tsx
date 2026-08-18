export default function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-line bg-white p-4">
      <p className="text-[0.7rem] tracking-[0.12em] uppercase text-ink-soft">
        {label}
      </p>
      <p className="mt-2 font-heading text-2xl text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
