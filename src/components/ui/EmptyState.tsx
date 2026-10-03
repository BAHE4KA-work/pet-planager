import type { ReactNode } from 'react';

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-5 py-8 text-center">
      {icon ? <div className="mb-2 flex justify-center text-[var(--ink-muted)]">{icon}</div> : null}
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-[var(--ink-muted)]">{description}</p> : null}
    </div>
  );
}
