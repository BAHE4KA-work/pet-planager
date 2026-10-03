import type { AiContradiction, AiProposalCard, LocaleKey } from '../types/planager';
import { localizedText } from '../utils/localization';

interface KnowledgeAiSidebarProps {
  locale: LocaleKey;
  enabled: boolean;
  proposals: AiProposalCard[];
  contradictions: AiContradiction[];
  onOpenAssistant: () => void;
  onFixContradiction: (contradiction: AiContradiction) => void;
  onApplyProposal: (proposal: AiProposalCard) => void;
  onRejectProposal: (proposal: AiProposalCard) => void;
}

export function KnowledgeAiSidebar({
  locale, enabled, proposals, contradictions, onOpenAssistant,
  onFixContradiction, onApplyProposal, onRejectProposal,
}: KnowledgeAiSidebarProps) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const visibleContradictions = contradictions.slice(0, 1);
  const visibleProposals = proposals.slice(0, 1);

  return (
    <div className="sidebar-section" style={{ background: 'rgba(239, 68, 68, 0.02)' }}>
      <div className="section-title" style={{ color: 'var(--ctx-neg-text)' }}>
        <span>{tx('Конфликты и ИИ', 'Conflicts & AI')}</span>
        <button type="button" onClick={onOpenAssistant} className="mono underline cursor-pointer text-[10px]">
          {tx('Все', 'All')} ({proposals.length + contradictions.length})
        </button>
      </div>

      {!enabled ? (
        <div className="mono text-xs">
          {tx('Ручной режим активен (ИИ отключён в Настройках).', 'Manual mode is active (AI is disabled in Settings).')}
        </div>
      ) : (
        <>
          {visibleContradictions.map((contradiction) => (
            <div
              key={contradiction.id}
              className="text-xs font-medium"
              style={{ color: 'var(--ctx-neg-text)', marginBottom: '18px' }}
            >
              <div style={{ marginBottom: '8px' }}>⚠ {contradiction.title}</div>
              {contradiction.suggestedFix && (
                <button type="button" onClick={() => onFixContradiction(contradiction)} className="btn py-1 px-2.5 text-[10px]">
                  {tx('Исправить конфликт', 'Fix conflict')}
                </button>
              )}
            </div>
          ))}
          {visibleProposals.map((proposal) => (
            <div key={proposal.id} className="ai-suggestion" style={{ marginTop: '14px' }}>
              <div className="label" style={{ marginBottom: '8px', color: 'var(--ctx-pos-text)' }}>
                {tx('Предложение ИИ', 'AI suggestion')}
              </div>
              <div style={{ fontSize: '0.8rem', marginBottom: '14px', lineHeight: 1.5 }}>
                {proposal.title}. <span className="mono">{proposal.rationale}</span>
              </div>
              {!proposal.suggestedElement && (
                <p className="text-xs text-[var(--ink-muted)] mb-2">
                  {tx('Нет проверенного структурированного элемента для добавления; доступно только текстовое объяснение.', 'No validated structured element is available to add; only an explanatory text is available.')}
                </p>
              )}
              <div className="btn-group">
                <button
                  type="button"
                  disabled={!proposal.suggestedElement}
                  title={!proposal.suggestedElement ? tx('Для добавления нужен структурированный элемент.', 'A structured element is required to apply this proposal.') : undefined}
                  onClick={() => onApplyProposal(proposal)}
                  className="btn pos flex-1"
                >
                  {tx('Применить', 'Apply')}
                </button>
                <button type="button" onClick={() => onRejectProposal(proposal)} className="btn neg flex-1">
                  {tx('Отклонить', 'Reject')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
