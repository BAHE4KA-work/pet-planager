import { useMemo, useState } from 'react';
import { Activity, KeyRound, LogIn, LogOut, Palette, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import type { AiProviderType, LocaleKey, NegativePaletteKey, PaletteKey, PositivePaletteKey, ThemeMode } from '../types/planager';
import { GEMINI_MODELS } from '../data/aiModels';
import { CONTEXT_PALETTES } from '../data/palettes';
import { getUsageBudgetTokens, type UsageEvent } from '../services/settings';
import { calculateHourlyUsageBuckets } from '../utils/usage';
import type { ChatGptModel } from '../services/chatgptOAuth';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { FormField, SelectInput, TextInput } from './ui/FormField';
import { localizedText } from '../utils/localization';
import { formatUsageAction, formatUsageStatus } from '../utils/usageLocalization';

type Limits = { rpm: number; rpd: number; tpm: number; totalTokens: number };
type Counts = Limits;
export interface SettingsViewProps {
  desktopAvailable: boolean;
  themeMode: ThemeMode;
  positivePalette: PositivePaletteKey;
  negativePalette: NegativePaletteKey;
  locale: LocaleKey;
  gitEnabled: boolean;
  aiProvider: AiProviderType;
  aiModel: string;
  customEndpoint: string;
  hasKey: boolean;
  chatgptConnected: boolean;
  chatgptEmail?: string;
  chatgptModels: ChatGptModel[];
  apiKeyDraft: string;
  rateLimits: Limits;
  usageEvents: UsageEvent[];
  usageCounts: Counts;
  onThemeChange(value: ThemeMode): void;
  onPositivePaletteChange(value: PositivePaletteKey): void;
  onNegativePaletteChange(value: NegativePaletteKey): void;
  onLocaleChange(value: LocaleKey): void;
  onGitEnabledChange(value: boolean): void;
  onProviderChange(value: AiProviderType): void;
  onModelChange(value: string): void;
  onEndpointChange(value: string): void;
  onApiKeyDraftChange(value: string): void;
  onChatgptConnect(): Promise<void>;
  onChatgptDisconnect(): Promise<void>;
  onChatgptSwitchAccount(): Promise<void>;
  onChatgptRefreshModels(): Promise<void>;
  onRateLimitsChange(next: Limits): void;
  onSaveSettings(secret?: string): Promise<void>;
  onTestProvider(): Promise<void>;
  onResetTotal(): Promise<void>;
  onSimulate(): Promise<void>;
  onRefreshUsage(): Promise<void>;
}

const text = (locale: LocaleKey, en: string, ru: string) => localizedText(locale, ru, en);
const paletteOptions: { key: PaletteKey; en: string; ru: string; color: string }[] =
  (Object.keys(CONTEXT_PALETTES) as PaletteKey[]).map((key) => ({
    key,
    en: CONTEXT_PALETTES[key].labelEn,
    ru: CONTEXT_PALETTES[key].labelRu,
    color: CONTEXT_PALETTES[key].main,
  }));
const themes: { key: ThemeMode; en: string; ru: string }[] = [
  { key: 'dark', en: 'Dark', ru: 'Тёмная' }, { key: 'classic', en: 'Classic', ru: 'Классическая' }, { key: 'light', en: 'Light', ru: 'Светлая' }, { key: 'system', en: 'System', ru: 'Системная' },
];
const metricLabels = (locale: LocaleKey) => [
  { key: 'rpm' as const, title: 'RPM', desc: text(locale, 'Requests per minute', 'Запросов в минуту'), unit: text(locale, 'requests', 'запросов') },
  { key: 'rpd' as const, title: 'RPD', desc: text(locale, 'Requests per 24 hours', 'Запросов за 24 часа'), unit: text(locale, 'requests', 'запросов') },
  { key: 'tpm' as const, title: 'TPM', desc: text(locale, 'Tokens per rolling minute', 'Токенов за скользящую минуту'), unit: text(locale, 'tokens', 'токенов') },
  { key: 'totalTokens' as const, title: 'TT', desc: text(locale, 'Cumulative tokens since reset', 'Всего токенов после сброса'), unit: text(locale, 'tokens', 'токенов') },
];
const formatNumber = (value: number, locale: LocaleKey) => new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US').format(value);

export function SettingsView(props: SettingsViewProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { locale } = props;
  const desktopAvailable = props.desktopAvailable;
  const realEvents = useMemo(() => props.usageEvents.filter((event) => !event.simulation && event.status !== 'counter-reset'), [props.usageEvents]);
  const simulationEvents = useMemo(() => props.usageEvents.filter((event) => event.simulation), [props.usageEvents]);
  const buckets = useMemo(() => calculateHourlyUsageBuckets(realEvents, locale), [realEvents, locale]);
  const maxTokens = Math.max(1, ...buckets.map((bucket) => bucket.tokens));
  const maxRequests = Math.max(1, ...buckets.map((bucket) => bucket.requests));
  const safeAction = async (name: string, action: () => Promise<void>, success?: string) => {
    setBusy(name); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const save = (test: boolean) => safeAction(test ? 'test' : 'save', async () => {
    const draft = props.apiKeyDraft.trim();
    await props.onSaveSettings(draft || undefined);
    if (draft) props.onApiKeyDraftChange('');
    if (test) await props.onTestProvider();
  }, text(locale, test ? 'Settings saved and provider test completed.' : 'Settings saved.', test ? 'Настройки сохранены, проверка провайдера завершена.' : 'Настройки сохранены.'));
  const setLimit = (key: keyof Limits, raw: string) => {
    const number = raw === '' ? 0 : Number(raw);
    props.onRateLimitsChange({ ...props.rateLimits, [key]: Number.isFinite(number) ? Math.max(0, Math.min(1_000_000_000, Math.floor(number))) : 0 });
  };
  const label = (en: string, ru: string) => text(locale, en, ru);

  return (
    <section className="editor-scroll mx-auto w-full max-w-6xl space-y-6 p-4 md:p-7" aria-labelledby="settings-title">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="label">{label('PREFERENCES', 'НАСТРОЙКИ')}</p><h1 id="settings-title" className="title-display text-3xl">{label('Settings', 'Настройки')}</h1></div>
        <div className="pill inline-flex items-center gap-2"><Settings2 size={14} aria-hidden="true" />{label('Saved on this device', 'Хранятся на этом устройстве')}</div>
      </header>
      {error ? <p className="rounded-lg border border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)] p-3 text-sm text-[var(--ctx-neg-text)]" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-[var(--ctx-pos-text)]" role="status">{notice}</p> : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6" aria-labelledby="appearance-title">
        <div className="mb-5 flex items-center gap-2"><Palette size={17} aria-hidden="true" className="text-[var(--accent)]"/><h2 id="appearance-title" className="section-title">{label('Appearance and language', 'Внешний вид и язык')}</h2></div>
        <div className="grid gap-5 md:grid-cols-2">
          <FormField id="theme-mode" label={label('Theme', 'Тема')}>
            <SelectInput id="theme-mode" value={props.themeMode} onChange={(event) => props.onThemeChange(event.target.value as ThemeMode)}>
              {themes.map((theme) => <option key={theme.key} value={theme.key}>{text(locale, theme.en, theme.ru)}</option>)}
            </SelectInput>
          </FormField>
          <FormField id="locale" label={label('Interface language', 'Язык интерфейса')}>
            <SelectInput id="locale" value={locale} onChange={(event) => props.onLocaleChange(event.target.value as LocaleKey)}><option value="ru">Русский</option><option value="en">English</option></SelectInput>
          </FormField>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {([
            { id: 'positive-palette', title: label('Positive context', 'Положительный контекст'), value: props.positivePalette, onChange: props.onPositivePaletteChange, tone: 'pos' },
            { id: 'negative-palette', title: label('Negative context', 'Отрицательный контекст'), value: props.negativePalette, onChange: props.onNegativePaletteChange, tone: 'neg' },
          ] as const).map((context) => (
            <fieldset key={context.id} className="min-w-0">
              <legend className="label mb-2">{context.title}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {paletteOptions.map((option) => {
                  const selected = context.value === option.key;
                  const selectedClass = context.tone === 'pos'
                    ? 'border-[var(--ctx-pos-border)] bg-[var(--ctx-pos-soft)]'
                    : 'border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)]';
                  return (
                    <button
                      key={`${context.id}-${option.key}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => context.onChange(option.key)}
                      className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${selected ? selectedClass : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}
                    >
                      <span className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
                      <span className="truncate">{text(locale, option.en, option.ru)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm"><input type="checkbox" checked={props.gitEnabled} disabled={!desktopAvailable} onChange={(event) => props.onGitEnabledChange(event.target.checked)} /><span>{label('Enable Git integration for this project', 'Включить Git для проекта')}</span></label>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6" aria-labelledby="provider-title">
        <div className="mb-5 flex items-center gap-2"><KeyRound size={17} aria-hidden="true" className="text-[var(--accent)]"/><h2 id="provider-title" className="section-title">{label('AI provider and usage limits', 'ИИ-провайдер и лимиты')}</h2></div>
        {!desktopAvailable ? <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--ink-muted)]" role="note">{label('Provider calls, credential storage, Git, and usage accounting require the Tauri desktop app. Browser preview never stores API credentials.', 'Вызовы провайдеров, хранение ключей, Git и учёт запросов доступны в приложении Tauri. Браузерный предпросмотр не сохраняет ключи API.')}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField id="provider" label={label('Provider', 'Провайдер')}>
            <SelectInput id="provider" value={props.aiProvider} disabled={!desktopAvailable} onChange={(event) => props.onProviderChange(event.target.value as AiProviderType)}><option value="gemini">Google Gemini</option><option value="custom">{label('Compatible custom endpoint', 'Совместимый сервер')}</option><option value="chatgpt">ChatGPT plan (OAuth)</option></SelectInput>
          </FormField>
          {props.aiProvider === 'gemini' ? <FormField id="model" label={label('Gemini model', 'Модель Gemini')}>
            <SelectInput id="model" value={props.aiModel} disabled={!desktopAvailable} onChange={(event) => props.onModelChange(event.target.value)}>
              {GEMINI_MODELS.map((model) => <option key={model}>{model}</option>)}
            </SelectInput>
          </FormField> : props.aiProvider === 'custom' ? <FormField id="model" label={label('Custom model name', 'Название модели')}>
            <TextInput id="model" value={props.aiModel} maxLength={200} disabled={!desktopAvailable} onChange={(event) => props.onModelChange(event.target.value)} placeholder="model-name" />
          </FormField> : <FormField id="model" label={label('ChatGPT plan model', 'Модель плана ChatGPT')} hint={label('Only models available to the connected account are listed.', 'Показаны только модели, доступные подключённому аккаунту.')}>
            <SelectInput id="model" value={props.aiModel} disabled={!desktopAvailable || !props.chatgptConnected || props.chatgptModels.length === 0} onChange={(event) => props.onModelChange(event.target.value)}>
              {props.chatgptModels.length ? props.chatgptModels.map((model) => <option key={model.slug} value={model.slug}>{model.displayName}</option>) : <option value="">{label('Connect ChatGPT to load models', 'Подключите ChatGPT, чтобы загрузить модели')}</option>}
            </SelectInput>
          </FormField>}
          <FormField id="custom-endpoint" label={label('Custom endpoint', 'Адрес сервера')} hint={label('Used only with the custom provider.', 'Используется только для своего провайдера.')}>
            <TextInput id="custom-endpoint" value={props.customEndpoint} maxLength={2048} disabled={!desktopAvailable || props.aiProvider !== 'custom'} onChange={(event) => props.onEndpointChange(event.target.value)} placeholder="https://…" />
          </FormField>
          {props.aiProvider !== 'chatgpt' ? <FormField id="api-key" label={label('Provider API key', 'Ключ API провайдера')} hint={!desktopAvailable ? label('Provider credentials are available in the Tauri desktop app only.', 'Ключи провайдера можно использовать только в приложении Tauri.') : props.hasKey ? label('In the desktop app, the key is stored in the operating system credential vault. Leave blank to keep it.', 'В desktop-приложении ключ хранится в защищённом хранилище ОС. Оставьте поле пустым, чтобы сохранить его.') : label('The desktop app stores the key in the operating system credential vault.', 'В desktop-приложении ключ хранится в защищённом хранилище ОС.')}>
            <TextInput id="api-key" type="password" autoComplete="new-password" value={props.apiKeyDraft} maxLength={262144} disabled={!desktopAvailable} onChange={(event) => props.onApiKeyDraftChange(event.target.value)} placeholder={props.hasKey ? '••••••••••••' : label('Enter API key', 'Введите ключ API')} />
          </FormField>
          : <div className="flex flex-col justify-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="text-sm">{props.chatgptConnected ? <>{label('Connected to ChatGPT', 'Подключён ChatGPT')}{props.chatgptEmail ? ` · ${props.chatgptEmail}` : ''}</> : label('Use your ChatGPT plan through the official open-source sign-in flow.', 'Используйте план ChatGPT через официальный OAuth-вход для open-source-приложений.')}</p>
              {props.chatgptConnected ? <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!desktopAvailable || busy !== null} icon={<LogOut size={14}/>} onClick={() => void safeAction('chatgpt-disconnect', props.onChatgptDisconnect)}>{label('Disconnect ChatGPT', 'Отключить ChatGPT')}</Button><Button size="sm" variant="quiet" disabled={!desktopAvailable || busy !== null} onClick={() => void safeAction('chatgpt-switch', props.onChatgptSwitchAccount)}>{label('Remove account and connect another', 'Удалить этот аккаунт и подключить другой')}</Button></div> : <Button size="sm" variant="primary" disabled={!desktopAvailable || busy !== null} icon={<LogIn size={14}/>} onClick={() => void safeAction('chatgpt-connect', props.onChatgptConnect)}>{label('Continue with ChatGPT', 'Войти через ChatGPT')}</Button>}
              {props.chatgptConnected ? <Button size="sm" disabled={!desktopAvailable || busy !== null} icon={<RefreshCw size={13}/>} onClick={() => void safeAction('chatgpt-models', props.onChatgptRefreshModels)}>{label('Refresh available models', 'Обновить список моделей')}</Button> : null}
            </div>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!desktopAvailable || busy !== null} onClick={() => void save(false)}>{busy === 'save' ? label('Saving…', 'Сохранение…') : label('Save settings', 'Сохранить настройки')}</Button>
          <Button variant="positive" disabled={!desktopAvailable || busy !== null} onClick={() => void save(true)}>{busy === 'test' ? label('Testing…', 'Проверка…') : label('Save and test connection', 'Сохранить и проверить')}</Button>
          {props.hasKey && props.aiProvider !== 'chatgpt' ? <span className="inline-flex items-center gap-1 text-xs text-[var(--ctx-pos-text)]"><ShieldCheck size={14} aria-hidden="true"/>{label('Key stored securely', 'Ключ защищён')}</span> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6" aria-labelledby="limits-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><div><h2 id="limits-title" className="section-title">{label('Usage safeguards', 'Ограничения использования')}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{label('A value of 0 disables that local limit. TPM uses a rolling 60-second window.', 'Значение 0 отключает лимит. TPM считается за скользящие 60 секунд.')}</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" icon={<RefreshCw size={13}/>} disabled={!desktopAvailable || busy !== null} onClick={() => void safeAction('refresh', props.onRefreshUsage)}>{label('Refresh', 'Обновить')}</Button><Button size="sm" disabled={!desktopAvailable || busy !== null} onClick={() => void safeAction('simulate', props.onSimulate)}>{label('Run simulator', 'Запустить симулятор')}</Button><Button size="sm" variant="danger" disabled={!desktopAvailable || busy !== null} onClick={() => void safeAction('reset', props.onResetTotal)}>{label('Reset total', 'Сбросить TT')}</Button></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricLabels(locale).map((metric) => {
            const cap = props.rateLimits[metric.key]; const used = props.usageCounts[metric.key]; const pct = cap > 0 ? Math.min(100, used / cap * 100) : 0;
            return <div key={metric.key} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-2 flex items-baseline justify-between"><strong className="mono text-sm text-[var(--accent)]">{metric.title}</strong><span className="text-[10px] text-[var(--ink-muted)]">{metric.desc}</span></div>
              <FormField id={`limit-${metric.key}`} label={label('Limit', 'Лимит')}>
                <TextInput id={`limit-${metric.key}`} type="number" inputMode="numeric" min={0} max={1_000_000_000} step={metric.key === 'tpm' || metric.key === 'totalTokens' ? 100 : 1} value={cap} disabled={!desktopAvailable} onChange={(event) => setLimit(metric.key, event.target.value)} />
              </FormField>
              <div className="mt-3 flex justify-between text-xs"><span>{label('Used', 'Использовано')}: {formatNumber(used, locale)}</span><span>{cap ? `${Math.round(pct)}%` : '—'}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]" role="progressbar" aria-label={`${metric.title} ${label('usage', 'использование')}`} aria-valuemin={0} aria-valuemax={cap || used || 1} aria-valuenow={used}><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${cap ? pct : used > 0 ? 100 : 0}%` }} /></div>
              <p className="mt-1 text-[10px] text-[var(--ink-muted)]">{metric.unit}</p>
            </div>;
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6" aria-labelledby="activity-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Activity size={16} aria-hidden="true" className="text-[var(--accent)]"/><h2 id="activity-title" className="section-title">{label('Real provider activity', 'Реальные запросы к провайдеру')}</h2><span className="pill">{realEvents.filter((event) => event.status !== 'limited').length}</span></div><p className="text-xs text-[var(--ink-muted)]">{label('Counts exclude simulations and rate-limited requests; unknown usage uses its reserved budget.', 'Счётчики не учитывают симуляции и отклонённые лимитом запросы; неизвестный расход учитывается по резерву.')}</p></div>
        {realEvents.length === 0 ? <EmptyState title={label('No real requests yet', 'Реальных запросов пока нет')} description={label('Connection tests and AI actions will appear here after they run.', 'Здесь появятся проверки подключения и действия ИИ после запуска.')} /> : <>
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3" aria-label={label('Real requests and token usage over the last six hours', 'Реальные запросы и токены за последние шесть часов')}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ink-muted)]">
              <div className="flex gap-3">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[var(--accent)]" aria-hidden="true" />{label('Tokens', 'Токены')}</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[var(--ctx-pos-text)]" aria-hidden="true" />{label('Requests', 'Запросы')}</span>
              </div>
              <span>{label('Local time · last six hours', 'Местное время · последние шесть часов')}</span>
            </div>
            <div className="flex h-28 items-end gap-2" role="img" aria-label={buckets.map((bucket) => `${bucket.label}: ${bucket.requests} ${label('requests', 'запросов')}, ${bucket.tokens} ${label('tokens', 'токенов')}`).join('; ')}>
              {buckets.map((bucket) => <div key={bucket.startMs} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[9px] text-[var(--ink-muted)]">{bucket.tokens ? formatNumber(bucket.tokens, locale) : ''}</span>
                <div className="flex h-full w-full items-end gap-0.5">
                  <div className="min-w-0 flex-1 rounded-t bg-[var(--accent)]" style={{ height: `${bucket.tokens ? Math.max(5, bucket.tokens / maxTokens * 68) : 0}%` }} title={`${bucket.label}: ${formatNumber(bucket.tokens, locale)} ${label('tokens', 'токенов')}`} />
                  <div className="min-w-0 flex-1 rounded-t bg-[var(--ctx-pos-text)]" style={{ height: `${bucket.requests ? Math.max(5, bucket.requests / maxRequests * 68) : 0}%` }} title={`${bucket.label}: ${formatNumber(bucket.requests, locale)} ${label('requests', 'запросов')}`} />
                </div>
                <span className="text-[10px] text-[var(--ink-muted)]">{bucket.label}</span>
              </div>)}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-[var(--surface-hover)] text-[var(--ink-muted)]"><tr>{[label('Time', 'Время'), label('Action', 'Действие'), label('Provider / model', 'Провайдер / модель'), label('Tokens', 'Токены'), label('Latency', 'Задержка'), label('Result', 'Результат')].map((heading) => <th key={heading} className="p-2.5 font-medium">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--border)]">{[...realEvents].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).map((event) => <tr key={event.id} className="hover:bg-[var(--surface-hover)]"><td className="p-2.5 whitespace-nowrap">{Number.isFinite(new Date(event.timestamp).getTime()) ? new Date(event.timestamp).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US') : event.timestamp}</td><td className="p-2.5">{formatUsageAction(event.action, locale)}</td><td className="p-2.5">{event.provider} · {event.model}</td><td className="p-2.5 tabular-nums">{event.usageKnown ? formatNumber(event.promptTokens + event.completionTokens, locale) : `${label('Usage unknown · reserved', 'Расход неизвестен · резерв')} ${formatNumber(getUsageBudgetTokens(event), locale)}`} <span className="text-[var(--ink-muted)]">({formatNumber(event.promptTokens, locale)} {label('input', 'вход')} + {formatNumber(event.completionTokens, locale)} {label('output', 'выход')})</span></td><td className="p-2.5 tabular-nums">{formatNumber(event.latencyMs, locale)} {label('ms', 'мс')}</td><td className="p-2.5"><span className={`pill ${event.status === 'completed' ? 'text-[var(--ctx-pos-text)]' : event.status === 'failed' ? 'text-[var(--ctx-neg-text)]' : ''}`}>{formatUsageStatus(event.status, locale)}{event.httpStatus ? ` · HTTP ${event.httpStatus}` : ''}</span></td></tr>)}</tbody></table></div>
        </>}
        <details className="mt-4 rounded-xl border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{label('Simulation history', 'История симуляций')} <span className="pill ml-1">{simulationEvents.length}</span></summary>
          <p className="my-2 text-xs text-[var(--ink-muted)]">{label('These test records are stored separately and never count as provider usage.', 'Тестовые записи хранятся отдельно и не учитываются как использование провайдера.')}</p>
          {simulationEvents.length ? <ul className="max-h-40 space-y-1 overflow-auto text-xs">{[...simulationEvents].reverse().map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2"><span>{formatUsageAction(event.action, locale)} · {new Date(event.timestamp).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US')}</span><span>{formatUsageStatus(event.status, locale)} · {formatNumber(event.promptTokens + event.completionTokens, locale)} {label('tokens', 'токенов')}</span></li>)}</ul> : <p className="text-xs text-[var(--ink-muted)]">{label('No simulations run.', 'Симуляций ещё не было.')}</p>}
        </details>
      </section>
    </section>
  );
}
