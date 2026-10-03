import type { LocaleKey } from '../types/planager';
import { localizedText } from './localization.ts';

const actions: Record<string, [english: string, russian: string]> = {
  analyze: ['Analysis', 'Анализ'],
  interview: ['Problem interview', 'Интервью по проблеме'],
  transform: ['Transformation', 'Трансформация'],
  test_provider: ['Provider connection test', 'Проверка подключения'],
  total_reset: ['Total counter reset', 'Сброс общего счётчика'],
};

const statuses: Record<string, [english: string, russian: string]> = {
  completed: ['Completed', 'Выполнен'],
  failed: ['Failed', 'Ошибка'],
  limited: ['Rate limited', 'Отклонён лимитом'],
  pending: ['In progress', 'Выполняется'],
  'counter-reset': ['Counter reset', 'Счётчик сброшен'],
  'simulation-admitted': ['Admitted by simulator', 'Допущен симулятором'],
  'simulation-limited': ['Limited by simulator', 'Отклонён симулятором'],
};

function localizedEntry(entry: [english: string, russian: string] | undefined, locale: LocaleKey, fallback: string) {
  return entry ? localizedText(locale, entry[1], entry[0]) : fallback;
}

export function formatUsageAction(action: string, locale: LocaleKey): string {
  const simulation = /^simulation_(\d+)$/.exec(action);
  if (simulation) {
    return localizedText(locale, `Симуляция №${simulation[1]}`, `Simulation #${simulation[1]}`);
  }
  return localizedEntry(actions[action], locale, action);
}

export function formatUsageStatus(status: string, locale: LocaleKey): string {
  return localizedEntry(statuses[status], locale, status);
}
