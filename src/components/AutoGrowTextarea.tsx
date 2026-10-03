import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';

export function AutoGrowTextarea({
  value,
  onChange,
  className,
  style,
  ariaLabel,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      wrap="soft"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={className}
      style={{ ...style, resize: 'none', overflow: 'hidden' }}
    />
  );
}
