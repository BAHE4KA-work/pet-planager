import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileCode2,
  HelpCircle,
  Layers,
  Pin,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  PlanElement,
} from '../types/planager';
import {
  buildRagIndex,
  generateLocalAnalysis,
  generateLocalInterviewQuestions,
  generateLocalTransformation,
} from '../utils/aiEngine';

interface AiAssistantPanelProps {
  elements: PlanElement[];
  files: string[];
  aiContextIds: string[];
  onToggleAiContext: (id: string) => void;
  onClearAiContext: () => void;
  onApplyProposal: (proposal: AiProposalCard) => void;
  onRejectProposalAsIdea: (proposal: AiProposalCard, reason: string) => void;
  onApplyContradictionFix: (contradiction: AiContradiction) => void;
  onAnswerInterviewQuestion: (question: AiInterviewQuestion, answer: string) => void;
  onApplyTransformation: (newElements: PlanElement[], sourceId: string) => void;
  onOpenCitationLineRange: (
    fileName: string,
    startLine: number,
    endLine: number,
    elementId?: string
  ) => void;
}

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  elements,
  files,
  aiContextIds,
  onToggleAiContext,
  onClearAiContext,
  onApplyProposal,
  onRejectProposalAsIdea,
  onApplyContradictionFix,
  onAnswerInterviewQuestion,
  onApplyTransformation,
  onOpenCitationLineRange,
}) => {
  const [activeTab, setActiveTab] = useState<
    'proposals' | 'contradictions' | 'interview' | 'transform'
  >('proposals');

  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<AiProposalCard[]>([]);
  const [contradictions, setContradictions] = useState<AiContradiction[]>([]);
  const [interviewQuestions, setInterviewQuestions] = useState<AiInterviewQuestion[]>([]);
  const [customGoal, setCustomGoal] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // Transform tab state
  const [transformSourceId, setTransformSourceId] = useState<string>(
    elements.find((e) => e.type === 'idea')?.id || elements[0]?.id || ''
  );
  const [transformPattern, setTransformPattern] = useState<
    'system_pack' | 'class_hierarchy' | 'process_chain'
  >('system_pack');
  const [lastTransformSummary, setLastTransformSummary] = useState<string | null>(null);

  const ragIndex = buildRagIndex(elements, files);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const selectedElements = elements.filter((e) => aiContextIds.includes(e.id));
      const localResult = generateLocalAnalysis(elements, aiContextIds, files);
      const localQuestions = generateLocalInterviewQuestions(elements, aiContextIds);

      // Call server-side Gemini endpoint (/api/ai/analyze) with graceful fallback
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedElements:
            selectedElements.length > 0 ? selectedElements : elements.slice(0, 5),
          allElementsSummary: elements.map((e) => ({
            id: e.id,
            type: e.type,
            title: e.title,
            parent: e.parent,
            mvp: e.mvp,
          })),
          fileSnippets: ragIndex.slice(0, 8),
          customGoal,
        }),
      });
      const json = await res.json();

      if (!json.fallback && json.data?.proposals?.length > 0) {
        setProposals(json.data.proposals);
        setContradictions(
          json.data.contradictions?.length > 0
            ? json.data.contradictions
            : localResult.contradictions
        );
      } else {
        setProposals(localResult.proposals);
        setContradictions(localResult.contradictions);
      }
      setInterviewQuestions(localQuestions);
    } catch {
      const localResult = generateLocalAnalysis(elements, aiContextIds, files);
      setProposals(localResult.proposals);
      setContradictions(localResult.contradictions);
      setInterviewQuestions(generateLocalInterviewQuestions(elements, aiContextIds));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const localResult = generateLocalAnalysis(elements, aiContextIds, files);
    setProposals(localResult.proposals);
    setContradictions(localResult.contradictions);
    setInterviewQuestions(generateLocalInterviewQuestions(elements, aiContextIds));
  }, [aiContextIds, elements.length]);

  const handleCitationClick = (citation?: string, targetElementId?: string) => {
    if (!citation) return;
    const match = citation.match(/^([^:]+):(\d+)-(\d+)$/);
    if (match) {
      onOpenCitationLineRange(
        match[1],
        parseInt(match[2], 10),
        parseInt(match[3], 10),
        targetElementId
      );
    }
  };

  const CATEGORY_LABELS: Record<AiProposalCard['category'], string> = {
    balance: 'Балансировка',
    new_element: 'Новый элемент',
    rethink: 'Переосмысление',
    polish: 'Консистентность',
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top Context & RAG Status Header */}
      <div
        className="px-6 py-4 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--ctx-pos)' }} />
            <h2 className="text-base font-semibold">
              ИИ-ассистент моделирования и проактивной проверки плана
            </h2>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Фокусируется на выделенных вами элементах в контексте, индексирует файлы{' '}
            <code className="font-mono-tabular">.pgr</code> по диапазонам строк и проактивно ищет противоречия.
          </p>
        </div>

        {/* Custom prompt / Re-scan button */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Уточнить задачу (напр., баланс износа и цен)..."
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            className="w-64 px-3 py-1.5 rounded border text-xs"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-hairline)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={runAnalysis}
            disabled={loading}
            className="px-3.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 btn-ctx-pos cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Анализ...' : 'Обновить анализ'}</span>
          </button>
        </div>
      </div>

      {/* Pinned Context Strip */}
      <div
        className="px-6 py-2.5 border-b flex items-center justify-between gap-3 text-xs flex-wrap"
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Pin className="w-3.5 h-3.5" style={{ color: 'var(--ctx-pos)' }} />
            Выделенный контекст ({aiContextIds.length}):
          </span>
          {aiContextIds.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>
              Весь проект (нажмите на булавку на любом элементе Холста, чтобы сфокусировать ИИ на конкретных блоках)
            </span>
          ) : (
            aiContextIds.map((id) => {
              const el = elements.find((e) => e.id === id);
              if (!el) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggleAiContext(id)}
                  className="px-2 py-0.5 rounded font-mono-tabular text-[11px] flex items-center gap-1 btn-ctx-pos-soft cursor-pointer"
                >
                  <span>{el.id}</span>
                  <X className="w-3 h-3" />
                </button>
              );
            })
          )}
        </div>
        {aiContextIds.length > 0 && (
          <button
            type="button"
            onClick={onClearAiContext}
            className="text-[11px] underline cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            Очистить фокус
          </button>
        )}
      </div>

      {/* Sub-navigation Tabs */}
      <div
        className="px-6 border-b flex items-center gap-6 text-xs font-medium"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('proposals')}
          className="py-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer"
          style={{
            borderColor:
              activeTab === 'proposals' ? 'var(--ctx-pos)' : 'transparent',
            color:
              activeTab === 'proposals'
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
          }}
        >
          <span>Карточки-предложения ({proposals.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('contradictions')}
          className="py-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer"
          style={{
            borderColor:
              activeTab === 'contradictions' ? 'var(--ctx-neg)' : 'transparent',
            color:
              activeTab === 'contradictions'
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
          }}
        >
          <AlertTriangle
            className="w-3.5 h-3.5"
            style={{ color: 'var(--ctx-neg)' }}
          />
          <span>Противоречия плана ({contradictions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('interview')}
          className="py-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer"
          style={{
            borderColor:
              activeTab === 'interview' ? 'var(--ctx-pos)' : 'transparent',
            color:
              activeTab === 'interview'
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
          }}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Проблемное интервью ({interviewQuestions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('transform')}
          className="py-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer"
          style={{
            borderColor:
              activeTab === 'transform' ? 'var(--ctx-pos)' : 'transparent',
            color:
              activeTab === 'transform'
                ? 'var(--text-primary)'
                : 'var(--text-secondary)',
          }}
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>Преобразование элементов</span>
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* TAB 1: PROPOSAL CARDS */}
        {activeTab === 'proposals' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-6xl">
            {proposals.map((prop) => (
              <div
                key={prop.id}
                className="p-4 rounded-lg border flex flex-col justify-between gap-3"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <div className="space-y-2">
                  {/* Unboxed clean metadata line */}
                  <div
                    className="flex items-center justify-between text-[11px] font-mono-tabular"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>
                      {CATEGORY_LABELS[prop.category]} · цель:{' '}
                      {prop.targetElementId || 'проект'}
                    </span>
                    {prop.fileCitation && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCitationClick(
                            prop.fileCitation,
                            prop.targetElementId
                          )
                        }
                        className="underline hover:opacity-80 cursor-pointer"
                        style={{ color: 'var(--ctx-pos)' }}
                        title="Открыть этот диапазон строк в Базе знаний"
                      >
                        {prop.fileCitation}
                      </button>
                    )}
                  </div>

                  <h3 className="text-sm font-semibold">{prop.title}</h3>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {prop.rationale}
                  </p>

                  {prop.suggestedElement && (
                    <div
                      className="p-2.5 rounded border font-mono-tabular text-[11px] space-y-1"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-hairline)',
                      }}
                    >
                      <div>
                        + id: <strong>{prop.suggestedElement.id}</strong> (
                        {prop.suggestedElement.type})
                      </div>
                      <div>parent: {prop.suggestedElement.parent}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {prop.suggestedElement.description}
                      </div>
                    </div>
                  )}
                </div>

                {/* Positive / Negative Contextual Actions */}
                {rejectingId === prop.id ? (
                  <div
                    className="p-2.5 rounded border space-y-2"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-strong)',
                    }}
                  >
                    <div className="text-[11px]">
                      Сохранить как отклонённую Идею-образ (с полями{' '}
                      <code>alt_to</code> и <code>alt_reason</code>):
                    </div>
                    <input
                      type="text"
                      placeholder="Причина отказа (например: усложняет MVP)..."
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-full px-2 py-1 rounded border text-xs"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-hairline)',
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onRejectProposalAsIdea(
                            prop,
                            rejectReason.trim() ||
                              'Отклонено на этапе ревью предложений ИИ'
                          );
                          setProposals((prev) =>
                            prev.filter((p) => p.id !== prop.id)
                          );
                          setRejectingId(null);
                          setRejectReason('');
                        }}
                        className="px-2.5 py-1 rounded text-xs btn-ctx-pos cursor-pointer"
                      >
                        Да, записать отказ в Идеи
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="px-2.5 py-1 rounded text-xs btn-ctx-neg cursor-pointer"
                      >
                        Нет
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        onApplyProposal(prop);
                        setProposals((prev) =>
                          prev.filter((p) => p.id !== prop.id)
                        );
                      }}
                      className="flex-1 py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-1.5 btn-ctx-pos cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Применить в план</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(prop.id)}
                      className="py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-1 btn-ctx-neg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Отклонить</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: PROACTIVE CONTRADICTIONS */}
        {activeTab === 'contradictions' && (
          <div className="space-y-3 max-w-5xl">
            {contradictions.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-lg border space-y-2.5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-hairline)',
                  borderLeftWidth: '3px',
                  borderLeftColor: 'var(--ctx-neg)',
                }}
              >
                <div
                  className="flex items-center justify-between text-[11px] font-mono-tabular"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>
                    Приоритет: {c.severity === 'high' ? 'высокий' : 'средний'} · Затронуты:{' '}
                    {c.elementIds.join(', ')}
                  </span>
                  {c.fileCitation && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCitationClick(c.fileCitation, c.elementIds[0])
                      }
                      className="underline cursor-pointer"
                      style={{ color: 'var(--ctx-pos)' }}
                    >
                      Открыть {c.fileCitation}
                    </button>
                  )}
                </div>

                <h3 className="text-sm font-semibold">{c.title}</h3>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {c.description}
                </p>

                <div
                  className="p-2.5 rounded text-xs flex items-center justify-between gap-4"
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  <div>
                    <span className="font-medium">Рекомендация: </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {c.resolutionHint}
                    </span>
                  </div>
                  {c.suggestedFix && (
                    <button
                      type="button"
                      onClick={() => {
                        onApplyContradictionFix(c);
                        setContradictions((prev) =>
                          prev.filter((item) => item.id !== c.id)
                        );
                      }}
                      className="px-3 py-1.5 rounded text-xs font-medium shrink-0 btn-ctx-pos cursor-pointer"
                    >
                      {c.suggestedFix.fixLabel}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: PROBLEM INTERVIEW */}
        {activeTab === 'interview' && (
          <div className="space-y-4 max-w-4xl">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Ответьте на точечные вопросы ассистента, чтобы закрыть «белые пятна» в правилах систем и автоматически дополнить описание соответствующих элементов плана:
            </p>
            {interviewQuestions.map((q) => (
              <div
                key={q.id}
                className="p-4 rounded-lg border space-y-3"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <div
                  className="text-[11px] font-mono-tabular"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Целевой узел: {q.targetElementId || 'общий контур'} · Слабое место:{' '}
                  {q.weakSpotContext}
                </div>
                <h4 className="text-sm font-semibold">{q.question}</h4>

                <div className="space-y-1.5">
                  {q.quickOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        onAnswerInterviewQuestion(q, opt);
                        setInterviewQuestions((prev) =>
                          prev.map((item) =>
                            item.id === q.id ? { ...item, userAnswer: opt } : item
                          )
                        );
                      }}
                      className="w-full text-left px-3 py-2 rounded border text-xs flex items-center justify-between hover:opacity-90 cursor-pointer"
                      style={{
                        backgroundColor:
                          q.userAnswer === opt
                            ? 'var(--ctx-pos-soft)'
                            : 'var(--bg-subtle)',
                        borderColor:
                          q.userAnswer === opt
                            ? 'var(--ctx-pos)'
                            : 'var(--border-hairline)',
                      }}
                    >
                      <span>{opt}</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  ))}
                </div>

                {/* Custom answer input */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Или сформулируйте своё правило..."
                    value={customAnswers[q.id] || ''}
                    onChange={(e) =>
                      setCustomAnswers((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    className="flex-1 px-3 py-1.5 rounded border text-xs"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const ans = customAnswers[q.id]?.trim();
                      if (!ans) return;
                      onAnswerInterviewQuestion(q, ans);
                      setInterviewQuestions((prev) =>
                        prev.map((item) =>
                          item.id === q.id ? { ...item, userAnswer: ans } : item
                        )
                      );
                    }}
                    className="px-3 py-1.5 rounded text-xs btn-ctx-pos cursor-pointer"
                  >
                    Зафиксировать в плане
                  </button>
                </div>

                {q.userAnswer && (
                  <div
                    className="text-xs font-medium"
                    style={{ color: 'var(--ctx-pos)' }}
                  >
                    ✓ Ответ записан в элемент {q.targetElementId}: «{q.userAnswer}»
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: ELEMENT TRANSFORMATION (e.g. Idea -> System + Classes preserving link) */}
        {activeTab === 'transform' && (
          <div className="max-w-3xl space-y-4">
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-hairline)',
              }}
            >
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4" style={{ color: 'var(--ctx-pos)' }} />
                <h3 className="text-sm font-semibold">
                  Преобразование одного элемента в систему связанных блоков
                </h3>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Выберите исходный элемент (например, отдельно стоящую <strong>Идею-образ</strong> на будущее), чтобы развернуть её в полноценную <strong>Систему</strong> с набором Классов, Компонентов и Процессов. Связь с исходным элементом (<code>origin</code> и <code>notes</code>) сохраняется автоматически.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Исходный элемент плана
                  </label>
                  <select
                    value={transformSourceId}
                    onChange={(e) => setTransformSourceId(e.target.value)}
                    className="w-full px-3 py-2 rounded border text-xs font-mono-tabular"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    {elements.map((el) => (
                      <option key={el.id} value={el.id}>
                        {el.id} — {el.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Шаблон развёртывания
                  </label>
                  <select
                    value={transformPattern}
                    onChange={(e) =>
                      setTransformPattern(
                        e.target.value as
                          | 'system_pack'
                          | 'class_hierarchy'
                          | 'process_chain'
                      )
                    }
                    className="w-full px-3 py-2 rounded border text-xs"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    <option value="system_pack">
                      Система + Компонент + Класс + Процесс-функция
                    </option>
                    <option value="class_hierarchy">
                      Класс + эталонный Объект-экземпляр (instance_of)
                    </option>
                    <option value="process_chain">
                      Пошаговая Процесс-функция взаимодействия
                    </option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const src = elements.find((e) => e.id === transformSourceId);
                  if (!src) return;
                  const res = generateLocalTransformation(src, transformPattern);
                  onApplyTransformation(res.createdElements, src.id);
                  setLastTransformSummary(res.summary);
                }}
                className="px-4 py-2 rounded text-xs font-medium btn-ctx-pos cursor-pointer"
              >
                Развернуть и добавить элементы на Холст
              </button>

              {lastTransformSummary && (
                <div
                  className="p-3 rounded border text-xs"
                  style={{
                    backgroundColor: 'var(--ctx-pos-soft)',
                    borderColor: 'var(--ctx-pos-border)',
                  }}
                >
                  {lastTransformSummary}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
