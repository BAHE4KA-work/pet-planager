import type { PaletteKey } from '../types/planager';

export interface ContextPalette {
  labelRu: string;
  labelEn: string;
  main: string;
  hover: string;
  soft: string;
  border: string;
  text: string;
  textDark: string;
}

/** One shared palette is used independently by positive and negative contexts. */
export const CONTEXT_PALETTES: Record<PaletteKey, ContextPalette> = {
  emerald: { labelRu: 'Изумрудная', labelEn: 'Emerald', main: '#15803D', hover: '#166534', soft: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.45)', text: '#15803D', textDark: '#4ade80' },
  violet: { labelRu: 'Фиолетовая', labelEn: 'Violet', main: '#6D28D9', hover: '#5B21B6', soft: 'rgba(167, 139, 250, 0.12)', border: 'rgba(167, 139, 250, 0.45)', text: '#6D28D9', textDark: '#a78bfa' },
  sapphire: { labelRu: 'Сапфировая', labelEn: 'Sapphire', main: '#1D4ED8', hover: '#1E40AF', soft: 'rgba(96, 165, 250, 0.12)', border: 'rgba(96, 165, 250, 0.45)', text: '#1D4ED8', textDark: '#60a5fa' },
  teal: { labelRu: 'Бирюзовая', labelEn: 'Teal', main: '#0F766E', hover: '#115E59', soft: 'rgba(45, 212, 191, 0.12)', border: 'rgba(45, 212, 191, 0.45)', text: '#0F766E', textDark: '#2dd4bf' },
  amber: { labelRu: 'Янтарная', labelEn: 'Amber', main: '#B45309', hover: '#92400E', soft: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.45)', text: '#B45309', textDark: '#fbbf24' },
  crimson: { labelRu: 'Малиновая', labelEn: 'Crimson', main: '#B91C1C', hover: '#991B1B', soft: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.45)', text: '#B91C1C', textDark: '#f87171' },
  rose: { labelRu: 'Розовая', labelEn: 'Rose', main: '#BE123C', hover: '#9F1239', soft: 'rgba(251, 113, 133, 0.12)', border: 'rgba(251, 113, 133, 0.45)', text: '#BE123C', textDark: '#fb7185' },
  ochre: { labelRu: 'Охристая', labelEn: 'Ochre', main: '#C2410C', hover: '#9A3412', soft: 'rgba(251, 146, 60, 0.12)', border: 'rgba(251, 146, 60, 0.45)', text: '#C2410C', textDark: '#fb923c' },
  slate: { labelRu: 'Сланцевая', labelEn: 'Slate', main: '#475569', hover: '#334155', soft: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.45)', text: '#475569', textDark: '#94a3b8' },
  indigo: { labelRu: 'Индиго', labelEn: 'Indigo', main: '#4338CA', hover: '#3730A3', soft: 'rgba(129, 140, 248, 0.12)', border: 'rgba(129, 140, 248, 0.45)', text: '#4338CA', textDark: '#818cf8' },
};

// Keep these names for existing context-specific callers while sharing all choices.
export const POSITIVE_PALETTES = CONTEXT_PALETTES;
export const NEGATIVE_PALETTES = CONTEXT_PALETTES;
