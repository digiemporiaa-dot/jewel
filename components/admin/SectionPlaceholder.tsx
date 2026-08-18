export default function SectionPlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-heading text-2xl">{title}</h1>
        <p className="text-sm text-ink-soft">{description}</p>
      </header>
      <div className="border border-line bg-white p-8 text-center">
        <p className="eyebrow">{phase}</p>
        <p className="mt-2 text-ink-soft max-w-md mx-auto text-sm">
          This section is scaffolded and access-controlled. Full functionality is
          delivered in {phase}. You are seeing it because your role grants access.
        </p>
      </div>
    </div>
  );
}
