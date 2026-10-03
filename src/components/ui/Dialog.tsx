import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { Button } from './Button';

export function Dialog({ open, title, description, children, onClose, closeLabel, actions, className = '', style }: {
  open: boolean; title: string; description?: string; children?: ReactNode; onClose: () => void; closeLabel: string; actions?: ReactNode; className?: string; style?: CSSProperties;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusInitial = () => {
      const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
      if (firstFocusable) firstFocusable.focus();
      else dialog?.focus();
    };
    focusInitial();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => item.offsetParent !== null);
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} style={style} className={`w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl outline-none ${className}`}>
        <h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
        {description ? <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{description}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-2">{actions ?? <Button onClick={onClose}>{closeLabel}</Button>}</div>
      </div>
    </div>
  );
}
