import { invoke } from '@tauri-apps/api/core';

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isDesktop()) {
    return Promise.reject(new Error(`Native command unavailable outside Planager Desktop: ${command}`));
  }
  return invoke<T>(command, args);
}
