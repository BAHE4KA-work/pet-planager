import type { GeminiModel } from '../types/planager.ts';

export const DEFAULT_GEMINI_MODEL: GeminiModel = 'gemini-3.8-flash';

export const GEMINI_MODELS: readonly GeminiModel[] = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
];

const RETIRED_MODEL_REPLACEMENTS: Record<string, GeminiModel> = {
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
};

export function normalizeGeminiModel(value: unknown): GeminiModel {
  if (typeof value === 'string' && GEMINI_MODELS.includes(value as GeminiModel)) {
    return value as GeminiModel;
  }
  if (typeof value === 'string' && RETIRED_MODEL_REPLACEMENTS[value]) {
    return RETIRED_MODEL_REPLACEMENTS[value];
  }
  return DEFAULT_GEMINI_MODEL;
}
