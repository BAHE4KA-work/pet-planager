import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type SharedProps = { id: string; label: string; hint?: string; error?: string; children?: ReactNode };

export function FormField({ id, label, hint, error, children }: SharedProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label block">{label}</label>
      {children}
      {error ? <p className="text-xs text-[var(--ctx-neg-text)]" role="alert">{error}</p> : hint ? <p className="text-xs text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}

const inputClass = 'sys-input w-full min-w-0';
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />; }
export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />; }
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`${inputClass} ${props.className ?? ''}`} />; }
