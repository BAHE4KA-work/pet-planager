import { desktopInvoke, isDesktop } from './desktop.ts';
import type { LocaleKey, NegativePaletteKey, PositivePaletteKey, ThemeMode, UnitLibraryItem, AiProviderConfig } from '../types/planager';
import { DEFAULT_GEMINI_MODEL, normalizeGeminiModel } from '../data/aiModels.ts';
export { getUsageBudgetTokens } from '../utils/usage.ts';

export interface AppSettings {
  themeMode: ThemeMode;
  positivePalette: PositivePaletteKey;
  negativePalette: NegativePaletteKey;
  locale: LocaleKey;
  gitEnabled: boolean;
  aiProvider: AiProviderConfig;
  rateLimits: { rpm: number; rpd: number; tpm: number; totalTokens: number };
  hasKey: boolean;
  apiKeyStatus: { gemini: boolean; custom: boolean };
}

export interface UsageEvent {
  id: string;
  timestamp: string;
  action: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reservedPromptTokens?: number;
  reservedCompletionTokens?: number;
  latencyMs: number;
  status: string;
  httpStatus?: number;
  simulation: boolean;
  usageKnown: boolean;
}


const SETTINGS_KEY = 'planager.browser-preview.settings.v1';
const LIBRARY_KEY = 'planager.browser-preview.library.v1';
const defaultSettings: AppSettings = {
  themeMode: 'dark', positivePalette: 'emerald', negativePalette: 'crimson', locale: 'ru', gitEnabled: true,
  aiProvider: { provider: 'gemini', geminiModel: DEFAULT_GEMINI_MODEL, customEndpoint: '', customModel: '', chatgptModel: '' },
  rateLimits: { rpm: 0, rpd: 0, tpm: 0, totalTokens: 0 }, hasKey: false, apiKeyStatus: { gemini: false, custom: false },
};

export async function loadSettings(): Promise<AppSettings> {
  if (isDesktop()) {
    const result = await desktopInvoke<{ settings: AppSettings; apiKeyStatus: AppSettings['apiKeyStatus'] }>('settings_load');
    return normalizeSettings({ ...defaultSettings, ...result.settings, apiKeyStatus: result.apiKeyStatus, hasKey: result.settings.hasKey });
  }
  const value = window.localStorage.getItem(SETTINGS_KEY);
  return value ? normalizeSettings({ ...defaultSettings, ...JSON.parse(value), hasKey: false }) : defaultSettings;
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    aiProvider: {
      ...settings.aiProvider,
      geminiModel: normalizeGeminiModel(settings.aiProvider.geminiModel),
    },
    apiKeyStatus: {
      gemini: settings.apiKeyStatus?.gemini === true,
      custom: settings.apiKeyStatus?.custom === true,
    },
  };
}

export async function saveSettings(settings: Omit<AppSettings, 'hasKey' | 'apiKeyStatus'>, secret?: string): Promise<{ hasKey: boolean; apiKeyStatus: AppSettings['apiKeyStatus'] }> {
  if (isDesktop()) return desktopInvoke<{ saved: true; hasKey: boolean; apiKeyStatus: AppSettings['apiKeyStatus'] }>('settings_save', { settings, ...(secret ? { secret } : {}) });
  if (secret) throw new Error('Provider credentials can only be saved by the Tauri desktop app');
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, hasKey: false }));
  return { hasKey: false, apiKeyStatus: { gemini: false, custom: false } };
}

export async function loadUnitLibrary(): Promise<UnitLibraryItem[]> {
  if (isDesktop()) {
    const result = await desktopInvoke<{ items: UnitLibraryItem[] }>('library_load');
    return result.items;
  }
  const value = window.localStorage.getItem(LIBRARY_KEY);
  return value ? JSON.parse(value) as UnitLibraryItem[] : [];
}

export async function saveUnitLibrary(items: UnitLibraryItem[]): Promise<void> {
  if (isDesktop()) {
    await desktopInvoke<{ saved: true }>('library_save', { items });
    return;
  }
  window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
}

export async function loadUsageEvents(): Promise<UsageEvent[]> {
  if (!isDesktop()) return [];
  const result = await desktopInvoke<{ events: UsageEvent[] }>('usage_list');
  return result.events;
}

export async function resetUsageTotal(): Promise<void> {
  if (!isDesktop()) throw new Error('Usage accounting is available in the Tauri desktop app');
  await desktopInvoke<{ ok: true }>('usage_reset_total');
}

export async function simulateUsage(count = 1): Promise<UsageEvent[]> {
  if (!isDesktop()) throw new Error('Usage simulation is available in the Tauri desktop app');
  const result = await desktopInvoke<{ events: UsageEvent[] }>('usage_simulate', { count });
  return result.events;
}
