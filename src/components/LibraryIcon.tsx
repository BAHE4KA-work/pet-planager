import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic.mjs';

export function LibraryIcon({ name, size = 22, className }: { name?: string; size?: number; className?: string }) {
  const safeName = name && iconNames.includes(name as IconName) ? name as IconName : 'box';
  return <DynamicIcon name={safeName} size={size} className={className} aria-hidden="true" />;
}
