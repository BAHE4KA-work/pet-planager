import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, ArrowLeft, Lightbulb, MessageSquare, Sparkles, Workflow } from 'lucide-react';
import type { AiContradiction, AiInterviewQuestion, AiProposalCard, PlanElement } from '../types/planager';
import type { SavedInterviewAnswer } from '../utils/interviewAnswers';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export type AiWorkflowModal = 'hub' | 'contradictions' | 'proposals' | 'interview' | 'transform' | null;
export type AiTransformPattern = 'system_pack' | 'class_hierarchy' | 'process_chain';

interface AiWorkflowDialogsProps {
  activeModal: AiWorkflowModal;
  locale: 'ru' | 'en';
  aiContextIds: string[];
  contradictionCount: number;
  contradictions: AiContradiction[];
  proposals: AiProposalCard[];
  interviewQuestions: AiInterviewQuestion[];
  savedInterviewAnswers: SavedInterviewAnswer[];
  interviewAnswerDrafts: Record<string, string>;
  elements: PlanElement[];
  transformSourceId: string;
  transformPattern: AiTransformPattern;
  transformSummary: string | null;
  onSetActiveModal: (modal: AiWorkflowModal) => void;
  onRunAnalysis: () => void;
  onOpenContradiction: (contradiction: AiContradiction) => void;
  onRunInterview: () => void;
  onApplyProposal: (proposal: AiProposalCard) => void;
  onRejectProposal: (proposal: AiProposalCard) => void;
  onAnswerDraftsChange: Dispatch<SetStateAction<Record<string, string>>>;
  onSubmitInterviewAnswer: (question: AiInterviewQuestion, answer: string) => void;
  onTransformSourceChange: (id: string) => void;
  onTransformPatternChange: (pattern: AiTransformPattern) => void;
  onRunTransformation: (source: PlanElement, pattern: AiTransformPattern) => void;
}

export function AiWorkflowDialogs(props: AiWorkflowDialogsProps) {
  const {
    activeModal, locale, aiContextIds, contradictionCount, contradictions, proposals, interviewQuestions, savedInterviewAnswers,
    interviewAnswerDrafts, elements, transformSourceId, transformPattern, transformSummary,
    onSetActiveModal, onRunAnalysis, onOpenContradiction, onRunInterview, onApplyProposal, onRejectProposal,
    onAnswerDraftsChange, onSubmitInterviewAnswer, onTransformSourceChange,
    onTransformPatternChange, onRunTransformation,
  } = props;
  const tx = (ru: string, en: string) => locale === 'ru' ? ru : en;
  const contextLabel = tx('Фокус (отправляются только выбранные элементы)', 'Focus (only selected elements are sent)');
  const contextValue = aiContextIds.length ? aiContextIds.join(', ') : tx('Весь проект', 'Entire project');

  return <>
    {activeModal === 'hub' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-6 backdrop-blur-xs">
        <div className="w-full max-w-lg border border-[var(--border)] rounded-xl bg-[var(--surface)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="p-4 sm:p-5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]">
            <div className="flex items-center gap-2.5">
              <div style={{ backgroundColor: 'var(--ctx-pos-soft)', borderColor: 'var(--ctx-pos-border)', color: 'var(--ctx-pos-text)' }} className="w-8 h-8 rounded-lg border flex items-center justify-center"><Sparkles size={16} /></div>
              <div>
                <div className="text-sm font-bold text-[var(--ink)] tracking-tight">{tx('Ассистент', 'Assistant')}</div>
                <div className="text-[11px] mono text-[var(--ink-muted)]">{tx('Выберите нужный раздел анализа', 'Choose an analysis area')}</div>
              </div>
            </div>
            <button type="button" onClick={() => onSetActiveModal(null)} className="btn p-1.5 shrink-0 rounded-lg hover:bg-[var(--surface-hover)]" title={tx('Закрыть', 'Close')}>✕</button>
          </div>
          <div className="p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3.5">
              <button type="button" onClick={() => { onSetActiveModal('contradictions'); onRunAnalysis(); }} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] hover:border-[var(--ctx-neg-border)] transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2.5 group relative shadow-xs">
                <div style={{ borderColor: 'var(--ctx-neg-border)', backgroundColor: 'var(--ctx-neg-soft)', color: 'var(--ctx-neg-text)' }} className="w-14 h-14 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-transform"><AlertTriangle size={26} /></div>
                <div><div className="text-xs font-semibold text-[var(--ink)] group-hover:text-[var(--ctx-neg-text)] transition-colors">{tx('Противоречия', 'Contradictions')}</div><div className="text-[10px] mono text-[var(--ink-muted)] mt-0.5">{contradictionCount} {tx('найдено', 'found')}</div></div>
              </button>
              <button type="button" onClick={() => { onSetActiveModal('proposals'); onRunAnalysis(); }} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] hover:border-[var(--ctx-pos-border)] transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2.5 group relative shadow-xs">
                <div style={{ borderColor: 'var(--ctx-pos-border)', backgroundColor: 'var(--ctx-pos-soft)', color: 'var(--ctx-pos-text)' }} className="w-14 h-14 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-transform"><Lightbulb size={26} /></div>
                <div><div className="text-xs font-semibold text-[var(--ink)] group-hover:text-[var(--ctx-pos-text)] transition-colors">{tx('Предложения', 'Proposals')}</div><div className="text-[10px] mono text-[var(--ink-muted)] mt-0.5">{proposals.length} {tx('доступно', 'available')}</div></div>
              </button>
              <button type="button" onClick={() => { onSetActiveModal('interview'); onRunInterview(); }} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2.5 group relative shadow-xs">
                <div style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }} className="w-14 h-14 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-transform"><MessageSquare size={26} /></div>
                <div><div className="text-xs font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">{tx('Интервью', 'Interview')}</div><div className="text-[10px] mono text-[var(--ink-muted)] mt-0.5">{interviewQuestions.length} {tx('вопросов', 'questions')}</div></div>
              </button>
              <button type="button" onClick={() => onSetActiveModal('transform')} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] hover:border-[var(--ink-muted)] transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2.5 group relative shadow-xs">
                <div className="w-14 h-14 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] flex items-center justify-center group-hover:scale-105 transition-transform"><Workflow size={26} /></div>
                <div><div className="text-xs font-semibold text-[var(--ink)] transition-colors">{tx('Преобразование', 'Transformation')}</div><div className="text-[10px] mono text-[var(--ink-muted)] mt-0.5">{tx('Развертывание', 'Expansion')}</div></div>
              </button>
            </div>
            <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] mono text-[var(--ink-muted)]">
              <span>{contextLabel}: {aiContextIds.length ? `${aiContextIds.length} ${tx('ID', 'IDs')}` : tx('Весь проект', 'Entire project')}</span>
              <span className="text-[10px]">{tx('Ctrl+ЛКМ для выбора', 'Ctrl+click to select')}</span>
            </div>
          </div>
        </div>
      </div>
    )}

    {activeModal === 'contradictions' && (
      <Dialog
        open
        title={tx(`Противоречия (${contradictions.length})`, `Contradictions (${contradictions.length})`)}
        description={`${contextLabel}: ${contextValue}`}
        onClose={() => onSetActiveModal(null)}
        closeLabel={tx('Закрыть', 'Close')}
        actions={(
          <>
            <Button onClick={() => onSetActiveModal('hub')}>{tx('К разделам', 'Analysis areas')}</Button>
            <Button variant="primary" onClick={onRunAnalysis}>{tx('Повторить анализ', 'Run analysis again')}</Button>
            <Button onClick={() => onSetActiveModal(null)}>{tx('Закрыть', 'Close')}</Button>
          </>
        )}
      >
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {contradictions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
              {tx('Противоречий для текущего контекста нет.', 'No contradictions were found for the current context.')}
            </div>
          ) : contradictions.map((contradiction) => (
            <article key={contradiction.id} className="space-y-2 rounded-xl border border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--ctx-neg-text)]">{contradiction.title}</h3>
                <span className="pill text-[10px]">{contradiction.severity === 'high' ? tx('Высокая серьёзность', 'High severity') : tx('Средняя серьёзность', 'Medium severity')}</span>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">{contradiction.description}</p>
              <p className="text-xs text-[var(--ink-muted)]"><strong>{tx('Затронуты', 'Affected')}:</strong> {contradiction.elementIds.join(', ')}</p>
              {contradiction.fileCitation ? <p className="mono text-[11px] text-[var(--ink-muted)]">{contradiction.fileCitation}</p> : null}
              <p className="text-xs text-[var(--ink-muted)]"><strong>{tx('Вариант решения', 'Resolution hint')}:</strong> {contradiction.resolutionHint}</p>
              <div className="flex justify-end">
                <Button size="sm" variant="danger" onClick={() => onOpenContradiction(contradiction)}>{tx('Открыть разбор', 'Review finding')}</Button>
              </div>
            </article>
          ))}
        </div>
      </Dialog>
    )}

    {activeModal === 'proposals' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-6 backdrop-blur-xs">
        <div className="w-full max-w-3xl max-h-[86vh] flex flex-col border border-[var(--border)] rounded-xl bg-[var(--surface)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="panel-header">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => onSetActiveModal('hub')} className="btn py-1 px-2.5 text-xs flex items-center gap-1.5" title={tx('Вернуться к выбору разделов', 'Back to analysis areas')}><ArrowLeft size={13} /><span>{tx('К разделам', 'Analysis areas')}</span></button>
              <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ctx-pos-text)' }}><Lightbulb size={15} /><span>{tx('Предложения', 'Proposals')} ({proposals.length})</span></div>
              <span className="pill text-[10px]">{contextLabel}: {contextValue}</span>
            </div>
            <button type="button" onClick={() => onSetActiveModal(null)} className="btn py-1 px-2.5">{tx('Закрыть', 'Close')}</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3">
            {proposals.length === 0 ? <div className="p-8 text-center text-xs text-[var(--ink-muted)] border border-dashed border-[var(--border)] rounded-xl">{tx('Нет активных предложений для текущего контекста элементов.', 'There are no active proposals for the current element context.')}</div> : proposals.map((proposal) => (
              <div key={proposal.id} className="p-3.5 border border-[var(--border)] rounded-lg bg-[var(--bg)] flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0"><div className="text-xs font-semibold text-[var(--ink)]">{proposal.title}</div><div className="mono text-xs text-[var(--ink-muted)] leading-relaxed">{proposal.rationale}</div>
                  {!proposal.suggestedElement && <p className="text-xs text-[var(--ink-muted)]">{tx('Нет проверенного структурированного элемента для добавления; доступно только текстовое объяснение.', 'No validated structured element is available to add; only an explanatory text is available.')}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" disabled={!proposal.suggestedElement} title={!proposal.suggestedElement ? tx('Для добавления нужен структурированный элемент.', 'A structured element is required to apply this proposal.') : undefined} onClick={() => onApplyProposal(proposal)} className="btn pos text-xs py-1.5 px-3">{tx('Применить', 'Apply')}</button>
                  <button type="button" onClick={() => onRejectProposal(proposal)} className="btn neg text-xs py-1.5 px-3">{tx('Отклонить', 'Reject')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {activeModal === 'interview' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-6 backdrop-blur-xs">
        <div className="w-full max-w-3xl max-h-[86vh] flex flex-col border border-[var(--border)] rounded-xl bg-[var(--surface)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="panel-header">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => onSetActiveModal('hub')} className="btn py-1 px-2.5 text-xs flex items-center gap-1.5" title={tx('Вернуться к выбору разделов', 'Back to analysis areas')}><ArrowLeft size={13} /><span>{tx('К разделам', 'Analysis areas')}</span></button>
              <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--accent)' }}><MessageSquare size={15} /><span>{tx('Проблемное интервью', 'Problem interview')} ({interviewQuestions.length})</span></div>
              <span className="pill text-[10px]">{contextLabel}: {contextValue}</span>
            </div>
            <button type="button" onClick={() => onSetActiveModal(null)} className="btn py-1 px-2.5">{tx('Закрыть', 'Close')}</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3.5">
            {savedInterviewAnswers.length > 0 && (
              <details className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  {tx('Сохранённые ответы', 'Saved answers')} ({savedInterviewAnswers.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {savedInterviewAnswers.map((saved) => (
                    <div key={saved.questionId} className="rounded border border-[var(--border)] p-2.5 text-xs">
                      <p className="font-medium">{saved.question || tx('Текст прошлого вопроса недоступен', 'Previous question text is unavailable')}</p>
                      <p className="mt-1 whitespace-pre-wrap text-[var(--ink-muted)]">{saved.answer}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {interviewQuestions.length === 0 ? <div className="p-8 text-center text-xs text-[var(--ink-muted)] border border-dashed border-[var(--border)] rounded-xl">{tx('Вопросы для интервью отсутствуют.', 'There are no interview questions.')}</div> : interviewQuestions.map((question) => (
              <div key={question.id} className="p-4 border border-[var(--border)] rounded-lg bg-[var(--bg)] space-y-2.5">
                <div className="text-xs font-semibold text-[var(--ink)]">{question.question}</div>
                <div className="mono text-xs text-[var(--ink-muted)] leading-relaxed">{question.weakSpotContext}</div>
                <div className="flex flex-wrap gap-2 pt-1">{question.quickOptions.map((option, index) => <button key={index} type="button" onClick={() => onSubmitInterviewAnswer(question, option)} className="btn text-xs py-1.5 px-2.5">→ {option}</button>)}</div>
                <div className="flex gap-2 pt-2">
                  <input aria-label={tx('Ваш ответ', 'Your answer')} className="sys-input flex-1 text-xs" value={interviewAnswerDrafts[question.id] || ''} onChange={(event) => onAnswerDraftsChange((previous) => ({ ...previous, [question.id]: event.target.value }))} placeholder={tx('Свой ответ…', 'Your answer…')} />
                  <button type="button" className="btn pos text-xs" disabled={!interviewAnswerDrafts[question.id]?.trim()} onClick={() => onSubmitInterviewAnswer(question, interviewAnswerDrafts[question.id].trim())}>{tx('Сохранить ответ', 'Save answer')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {activeModal === 'transform' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-6 backdrop-blur-xs">
        <div className="w-full max-w-2xl max-h-[86vh] flex flex-col border border-[var(--border)] rounded-xl bg-[var(--surface)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="panel-header">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => onSetActiveModal('hub')} className="btn py-1 px-2.5 text-xs flex items-center gap-1.5" title={tx('Вернуться к выбору разделов', 'Back to analysis areas')}><ArrowLeft size={13} /><span>{tx('К разделам', 'Analysis areas')}</span></button>
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]"><Workflow size={15} /><span>{tx('Преобразование элемента', 'Transform element')}</span></div>
            </div>
            <button type="button" onClick={() => onSetActiveModal(null)} className="btn py-1 px-2.5">{tx('Закрыть', 'Close')}</button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
            <div className="p-4 border border-[var(--border)] rounded-xl bg-[var(--bg)] space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="label block mb-1">{tx('Исходный элемент плана', 'Source plan element')}</label><select aria-label={tx('Исходный элемент плана', 'Source plan element')} value={transformSourceId} onChange={(event) => onTransformSourceChange(event.target.value)} className="sys-input w-full mono text-xs">{elements.map((element) => <option key={element.id} value={element.id}>{element.id} — {element.title}</option>)}</select></div>
                <div><label className="label block mb-1">{tx('Шаблон развёртывания', 'Expansion template')}</label><select aria-label={tx('Шаблон развёртывания', 'Expansion template')} value={transformPattern} onChange={(event) => onTransformPatternChange(event.target.value as AiTransformPattern)} className="sys-input w-full text-xs">
                  <option value="system_pack">{tx('Система + Компонент + Класс', 'System + Component + Class')}</option>
                  <option value="class_hierarchy">{tx('Класс + эталонный Объект (instance_of)', 'Class + reference Object (instance_of)')}</option>
                  <option value="process_chain">{tx('Пошаговая Процесс-функция', 'Step-by-step Process')}</option>
                </select></div>
              </div>
              <button type="button" onClick={() => { const source = elements.find((element) => element.id === transformSourceId) || elements[0]; if (source) onRunTransformation(source, transformPattern); }} className="btn pos text-xs py-2 px-4">{tx('Развернуть и добавить на Холст', 'Expand and add to Canvas')}</button>
              {transformSummary && <div style={{ borderColor: 'var(--ctx-pos-border)', backgroundColor: 'var(--ctx-pos-soft)', color: 'var(--ctx-pos-text)' }} className="p-3 rounded-lg border mono text-xs leading-relaxed">{transformSummary}</div>}
            </div>
          </div>
        </div>
      </div>
    )}
  </>;
}
