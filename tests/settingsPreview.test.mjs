import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/services/settings.ts';

test('browser preview refuses provider secrets and never reports a key as stored', async (context) => {
  const store = new Map();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    } },
  });
  context.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });

  const settings = {
    themeMode: 'dark', positivePalette: 'emerald', negativePalette: 'crimson', locale: 'ru', gitEnabled: true,
    aiProvider: { provider: 'gemini', geminiModel: 'gemini-3-flash-preview', customEndpoint: '', customModel: '', chatgptModel: '' },
    rateLimits: { rpm: 0, rpd: 0, tpm: 0, totalTokens: 0 },
  };
  await assert.rejects(saveSettings(settings, 'secret-value'), /only be saved by the Tauri desktop app/);
  assert.equal(store.size, 0);
  assert.deepEqual(await saveSettings(settings), {
    hasKey: false,
    apiKeyStatus: { gemini: false, custom: false },
  });
  assert.equal((await loadSettings()).hasKey, false);
  assert.equal([...store.values()].some((value) => value.includes('secret-value')), false);
});
