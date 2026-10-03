import type { LocaleKey } from '../types/planager';

/** Returns the Russian or English copy for the app's current locale. */
export function localizedText(locale: LocaleKey, russian: string, english: string): string {
  return locale === 'ru' ? russian : english;
}
