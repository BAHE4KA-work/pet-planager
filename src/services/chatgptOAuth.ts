import { desktopInvoke } from './desktop';

export type ChatGptAccount = { connected: boolean; email?: string; expiresAt?: number };
export type ChatGptModel = { slug: string; displayName: string };
export type ChatGptDisconnectResult = { connected: false; revoked: boolean; warning?: string };

export const getChatGptStatus = () => desktopInvoke<ChatGptAccount>('openai_status');
export const connectChatGpt = () => desktopInvoke<ChatGptAccount>('openai_connect');
export const disconnectChatGpt = () => desktopInvoke<ChatGptDisconnectResult>('openai_sign_out');
export const forgetChatGpt = () => desktopInvoke<ChatGptDisconnectResult>('openai_forget_account');
export const loadChatGptModels = () => desktopInvoke<{ models: ChatGptModel[] }>('openai_models');
