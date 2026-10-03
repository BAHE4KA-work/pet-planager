import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'positive' | 'danger' | 'quiet';
  size?: 'sm' | 'md';
  icon?: ReactNode;
};

export function Button({ variant = 'default', size = 'md', icon, className = '', children, type = 'button', ...props }: ButtonProps) {
  const variants = {
    default: 'btn',
    primary: 'btn primary',
    positive: 'btn pos',
    danger: 'btn neg',
    quiet: 'btn border-transparent bg-transparent',
  };
  return (
    <button type={type} className={`${variants[variant]} inline-flex items-center justify-center gap-2 ${size === 'sm' ? 'px-2.5 py-1.5 text-xs' : ''} ${className}`.trim()} {...props}>
      {icon}{children}
    </button>
  );
}
