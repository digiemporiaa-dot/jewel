import Link from 'next/link';

export default function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; href: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl">{title}</h1>
        {description && <p className="text-sm text-ink-soft">{description}</p>}
      </div>
      {action && (
        <Link href={action.href} className="btn-primary text-xs">
          {action.label}
        </Link>
      )}
    </header>
  );
}
