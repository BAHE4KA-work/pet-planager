import { useEffect, useState } from 'react';
import type { PlanElement } from '../types/planager';

interface ElementIdentityFieldsProps {
  element: PlanElement;
  elements: PlanElement[];
  onChange: (element: PlanElement) => void;
  onRenameId: (oldId: string, newId: string) => boolean;
  onCursorLine: (line: number) => void;
  tx: (ru: string, en: string) => string;
}

export function ElementIdentityFields({
  element,
  elements,
  onChange,
  onRenameId,
  onCursorLine,
  tx,
}: ElementIdentityFieldsProps) {
  const [idDraft, setIdDraft] = useState(element.id);

  useEffect(() => setIdDraft(element.id), [element.id]);

  const commitId = () => {
    const nextId = idDraft.trim();
    if (nextId === element.id) {
      setIdDraft(element.id);
      return;
    }
    if (!onRenameId(element.id, nextId)) setIdDraft(element.id);
  };

  return (
    <div className="field-row" onClick={() => onCursorLine(2)}>
      <div className="field-label">{tx('Идентификатор', 'Identity')}</div>
      <div className="field-value">
        <div className="identity-grid">
          <span className="label">id:</span>
          <input
            type="text"
            value={idDraft}
            onChange={(event) => setIdDraft(event.target.value)}
            onBlur={commitId}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="identity-control"
            style={{ color: 'var(--accent)' }}
          />

          {element.type !== 'system' && (
            <>
              <span className="label">parent:</span>
              <select
                value={element.parent || '-'}
                onChange={(event) => onChange({ ...element, parent: event.target.value })}
                className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
              >
                <option value="-" className="bg-[var(--surface)] text-[var(--ink)]">
                  {tx('- (без родителя)', '- (no parent)')}
                </option>
                {elements.filter((candidate) => candidate.type === 'system').map((system) => (
                  <option key={system.id} value={system.id} className="bg-[var(--surface)] text-[var(--ink)]">
                    {system.id}
                  </option>
                ))}
              </select>
            </>
          )}

          {element.type === 'class' && (
            <>
              <span className="label">extends:</span>
              <select
                value={element.extendsId || '-'}
                onChange={(event) => onChange({ ...element, extendsId: event.target.value })}
                className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
              >
                <option value="-" className="bg-[var(--surface)] text-[var(--ink)]">-</option>
                {elements.filter((candidate) => candidate.type === 'class' && candidate.id !== element.id).map((classElement) => (
                  <option key={classElement.id} value={classElement.id} className="bg-[var(--surface)] text-[var(--ink)]">
                    {classElement.id}
                  </option>
                ))}
              </select>
            </>
          )}

          {element.type === 'object' && (
            <>
              <span className="label">instance_of:</span>
              <select
                value={element.instanceOf || '-'}
                onChange={(event) => onChange({ ...element, instanceOf: event.target.value })}
                className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
              >
                <option value="-" className="bg-[var(--surface)] text-[var(--ink)]">
                  {tx('- (только классы)', '- (classes only)')}
                </option>
                {elements.filter((candidate) => candidate.type === 'class').map((classElement) => (
                  <option key={classElement.id} value={classElement.id} className="bg-[var(--surface)] text-[var(--ink)]">
                    {classElement.id}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
