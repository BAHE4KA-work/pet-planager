import { Blocks, Diamond, Focus, Group, Lightbulb, Workflow } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ElementType } from '../types/planager';

export const ELEMENT_TYPE_ACCENTS: Record<ElementType, string> = {
  system: '#0EA5E9',
  class: '#3B82F6',
  process: '#8B5CF6',
  component: '#10B981',
  object: '#F59E0B',
  idea: '#64748B',
};

export const ELEMENT_TYPE_ICONS: Record<ElementType, ComponentType<{ size?: number; className?: string }>> = {
  system: Blocks,
  class: Group,
  object: Focus,
  component: Diamond,
  process: Workflow,
  idea: Lightbulb,
};

export function ElementTypeIcon({ type, size, className }: { type: ElementType; size?: number; className?: string }) {
  const Icon = ELEMENT_TYPE_ICONS[type];
  return <Icon size={size} className={className} />;
}
