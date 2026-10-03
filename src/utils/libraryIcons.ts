import type { ElementType } from '../types/planager';

const DEFAULT_ICON_BY_TYPE: Record<ElementType, string> = {
  system: 'blocks',
  class: 'boxes',
  process: 'workflow',
  component: 'component',
  object: 'box',
  idea: 'lightbulb',
};

export function defaultLibraryIcon(type: ElementType): string {
  return DEFAULT_ICON_BY_TYPE[type];
}
