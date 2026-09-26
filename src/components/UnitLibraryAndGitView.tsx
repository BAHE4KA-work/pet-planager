import React, { useState } from 'react';
import {
  Bookmark,
  Check,
  GitCommitHorizontal,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  ElementType,
  GitCommit,
  PlanElement,
  UnitLibraryItem,
} from '../types/planager';
import {
  computeLineDiff,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
} from '../utils/pgrCodec';
import { ELEMENT_TYPE_ACCENTS, ElementTypeIcon } from './CanvasView';

interface UnitLibraryViewProps {
  units: UnitLibraryItem[];
  files: string[];
  activeFile: string;
  onInsertUnitIntoProject: (unit: UnitLibraryItem, targetFile: string) => void;
  onDeleteUnit: (unitId: string) => void;
}

export const UnitLibraryView: React.FC<UnitLibraryViewProps> = ({
  units,
  files,
  activeFile,
  onInsertUnitIntoProject,
  onDeleteUnit,
}) => {
  const [targetFile, setTargetFile] = useState<string>(activeFile || files[0] || 'inventory.pgr');
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');

  const filteredUnits = units.filter((u) =>
    typeFilter === 'all' ? true : u.element.type === typeFilter
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div
        className="px-6 py-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4" style={{ color: 'var(--ctx-pos)' }} />
            <h2 className="text-base font-semibold">
              Библиотека юнитов (переиспользуемые элементы плана)
            </h2>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Готовые Системы, Классы, Компоненты и Процессы для быстрого добавления в текущий или новый проект.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>Целевой файл вставки:</span>
          <select
            value={targetFile}
            onChange={(e) => setTargetFile(e.target.value)}
            className="px-2.5 py-1.5 rounded border font-mono-tabular"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-hairline)',
            }}
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="px-6 py-2.5 border-b flex items-center gap-2 text-xs"
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <button
          type="button"
          onClick={() => setTypeFilter('all')}
          className="px-2.5 py-1 rounded cursor-pointer"
          style={{
            backgroundColor:
              typeFilter === 'all' ? 'var(--bg-surface)' : 'transparent',
            fontWeight: typeFilter === 'all' ? 600 : 400,
          }}
        >
          Все типы ({units.length})
        </button>
        {(
          ['system', 'class', 'process', 'component', 'object', 'idea'] as ElementType[]
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className="px-2.5 py-1 rounded cursor-pointer"
            style={{
              backgroundColor:
                typeFilter === t ? 'var(--bg-surface)' : 'transparent',
              fontWeight: typeFilter === t ? 600 : 400,
            }}
          >
            {TYPE_HEADERS_RU[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl">
          {filteredUnits.map((unit) => {
            const accent = ELEMENT_TYPE_ACCENTS[unit.element.type];
            return (
              <div
                key={unit.unitId}
                className="p-4 rounded-lg border flex flex-col justify-between gap-3"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-hairline)',
                  borderTopWidth: '3px',
                  borderTopColor: accent,
                }}
              >
                <div className="space-y-1.5">
                  <div
                    className="flex items-center justify-between text-[11px] font-mono-tabular"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span
                      className="inline-flex items-center gap-1 font-medium"
                      style={{ color: accent }}
                    >
                      <ElementTypeIcon
                        type={unit.element.type}
                        className="w-3.5 h-3.5"
                      />
                      {TYPE_HEADERS_RU[unit.element.type]}
                    </span>
                    <span>{unit.element.id} · {unit.savedAt}</span>
                  </div>
                  <h3 className="text-sm font-semibold">{unit.element.title}</h3>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {unit.element.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onInsertUnitIntoProject(unit, targetFile)}
                    className="flex-1 py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-1.5 btn-ctx-pos cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Вставить в {targetFile}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteUnit(unit.unitId)}
                    className="p-1.5 rounded btn-ctx-neg-soft cursor-pointer"
                    title="Удалить из библиотеки"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface GitVersionViewProps {
  elements: PlanElement[];
  files: string[];
  commits: GitCommit[];
  onCreateCommit: (message: string) => void;
  onRestoreCommit: (commit: GitCommit) => void;
}

export const GitVersionView: React.FC<GitVersionViewProps> = ({
  elements,
  files,
  commits,
  onCreateCommit,
  onRestoreCommit,
}) => {
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<string>(files[0] || 'inventory.pgr');
  const [comparedCommitId, setComparedCommitId] = useState<string>(
    commits[0]?.id || ''
  );

  const baseCommit =
    commits.find((c) => c.id === comparedCommitId) || commits[0];

  const oldContent = baseCommit?.filesSnapshot[selectedFile] || '';
  const { content: currentContent } = serializeFileWithRanges(
    elements,
    selectedFile
  );

  const diffLines = computeLineDiff(oldContent, currentContent);
  const addedCount = diffLines.filter((d) => d.type === 'added').length;
  const removedCount = diffLines.filter((d) => d.type === 'removed').length;

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left: Git Commit History & New Commit Box */}
      <div
        className="w-80 border-r flex flex-col shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div
          className="p-4 border-b space-y-2.5"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <GitCommitHorizontal
              className="w-4 h-4"
              style={{ color: 'var(--ctx-pos)' }}
            />
            <span>Зафиксировать изменения (git commit)</span>
          </div>
          <input
            type="text"
            placeholder="Сообщение коммита (напр., баланс оружия)..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded border text-xs"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-hairline)',
            }}
          />
          <button
            type="button"
            onClick={() => {
              onCreateCommit(
                commitMessage.trim() || 'Обновление структуры плана .pgr'
              );
              setCommitMessage('');
            }}
            className="w-full py-1.5 px-3 rounded text-xs font-medium flex items-center justify-center gap-1.5 btn-ctx-pos cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Создать коммит .pgr</span>
          </button>
        </div>

        <div
          className="px-4 py-2 border-b text-[11px] font-medium flex items-center gap-1.5"
          style={{
            borderColor: 'var(--border-hairline)',
            color: 'var(--text-muted)',
          }}
        >
          <History className="w-3.5 h-3.5" />
          <span>История ревизий ({commits.length})</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {commits.map((c) => {
            const isSelected = c.id === baseCommit?.id;
            return (
              <div
                key={c.id}
                onClick={() => setComparedCommitId(c.id)}
                className="p-3 rounded-lg border text-xs space-y-1.5 cursor-pointer"
                style={{
                  backgroundColor: isSelected
                    ? 'var(--bg-subtle)'
                    : 'var(--bg-surface)',
                  borderColor: isSelected
                    ? 'var(--ctx-pos)'
                    : 'var(--border-hairline)',
                }}
              >
                <div
                  className="flex items-center justify-between font-mono-tabular text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>#{c.hash}</span>
                  <span>{c.timestamp}</span>
                </div>
                <div className="font-medium">{c.message}</div>
                <div className="flex items-center justify-between pt-1">
                  <span
                    className="text-[11px] font-mono-tabular"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Элементов: {c.elementsSnapshot.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestoreCommit(c);
                    }}
                    className="px-2 py-0.5 rounded text-[11px] flex items-center gap-1 border cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-hairline)',
                    }}
                    title="Откатить рабочее дерево к этому коммиту"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Откатить</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Line-Stable .pgr Git Diff Viewer */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div
          className="px-6 py-3 border-b flex items-center justify-between gap-4 flex-wrap text-xs"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-hairline)',
          }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--text-secondary)' }}>
              Сравнение рабочей копии с коммитом{' '}
              <code className="font-mono-tabular">#{baseCommit?.hash}</code>:
            </span>
            {files.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedFile(f)}
                className="px-2.5 py-1 rounded font-mono-tabular cursor-pointer"
                style={{
                  backgroundColor:
                    selectedFile === f ? 'var(--bg-subtle)' : 'transparent',
                  fontWeight: selectedFile === f ? 600 : 400,
                  border:
                    selectedFile === f
                      ? '1px solid var(--border-strong)'
                      : '1px solid transparent',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 font-mono-tabular">
            <span style={{ color: 'var(--ctx-pos)' }}>+{addedCount} строк</span>
            <span style={{ color: 'var(--ctx-neg)' }}>-{removedCount} строк</span>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto p-4 font-mono-tabular text-xs leading-relaxed"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          {diffLines.map((line, idx) => {
            const bg =
              line.type === 'added'
                ? 'var(--ctx-pos-soft)'
                : line.type === 'removed'
                ? 'var(--ctx-neg-soft)'
                : 'transparent';
            const textColor =
              line.type === 'added'
                ? 'var(--ctx-pos)'
                : line.type === 'removed'
                ? 'var(--ctx-neg)'
                : 'var(--text-primary)';
            const prefix =
              line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

            return (
              <div
                key={idx}
                className="flex items-baseline gap-3 px-2 py-0.5 rounded"
                style={{ backgroundColor: bg, color: textColor }}
              >
                <span
                  className="w-7 text-right select-none text-[11px] opacity-60"
                >
                  {line.oldLineNumber ?? ''}
                </span>
                <span
                  className="w-7 text-right select-none text-[11px] opacity-60"
                >
                  {line.newLineNumber ?? ''}
                </span>
                <span className="w-3 select-none font-bold">{prefix}</span>
                <span className="whitespace-pre-wrap break-all">
                  {line.content || ' '}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
