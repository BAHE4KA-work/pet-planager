import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  FileCode2,
  FilePlus2,
  Filter,
  FolderOpen,
  Pin,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { ElementType, PlanElement } from '../types/planager';
import {
  parsePgrFileContent,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
} from '../utils/pgrCodec';
import { ELEMENT_TYPE_ACCENTS, ElementTypeIcon } from './CanvasView';

interface KnowledgeBaseViewProps {
  elements: PlanElement[];
  files: string[];
  activeFile: string;
  selectedElementId: string | null;
  aiContextIds: string[];
  highlightedLineRange: { start: number; end: number } | null;
  onSelectFile: (fileName: string) => void;
  onCreateFile: (fileName: string) => void;
  onSelectElement: (id: string) => void;
  onToggleAiContext: (id: string) => void;
  onApplyRawPgrEdit: (fileName: string, parsedElements: PlanElement[]) => void;
  onCreateElementInFile: (fileName: string, type: ElementType) => void;
  onSetLineRange: (range: { start: number; end: number } | null) => void;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  elements,
  files,
  activeFile,
  selectedElementId,
  aiContextIds,
  highlightedLineRange,
  onSelectFile,
  onCreateFile,
  onSelectElement,
  onToggleAiContext,
  onApplyRawPgrEdit,
  onCreateElementInFile,
  onSetLineRange,
}) => {
  const [newFileName, setNewFileName] = useState('');
  const [addingFile, setAddingFile] = useState(false);

  const { content: canonicalPgr, ranges } = serializeFileWithRanges(
    elements,
    activeFile
  );

  const [rawDraft, setRawDraft] = useState(canonicalPgr);
  const [isDirty, setIsDirty] = useState(false);
  const [rangeStartInput, setRangeStartInput] = useState<string>('');
  const [rangeEndInput, setRangeEndInput] = useState<string>('');
  const [onlyShowRangeLines, setOnlyShowRangeLines] = useState<boolean>(false);

  useEffect(() => {
    setRawDraft(canonicalPgr);
    setIsDirty(false);
  }, [canonicalPgr, activeFile]);

  useEffect(() => {
    if (highlightedLineRange) {
      setRangeStartInput(String(highlightedLineRange.start));
      setRangeEndInput(String(highlightedLineRange.end));
    } else {
      setRangeStartInput('');
      setRangeEndInput('');
      setOnlyShowRangeLines(false);
    }
  }, [highlightedLineRange]);

  const lines = rawDraft.split('\n');
  const totalLines = lines.length;

  const applyLineRangeFilter = () => {
    const s = parseInt(rangeStartInput, 10);
    const e = parseInt(rangeEndInput, 10);
    if (!isNaN(s) && !isNaN(e) && s >= 1 && e >= s) {
      onSetLineRange({ start: s, end: Math.min(e, totalLines) });
    } else {
      onSetLineRange(null);
    }
  };

  const handleSaveRawPgr = () => {
    const parsed = parsePgrFileContent(rawDraft, activeFile, elements);
    onApplyRawPgrEdit(activeFile, parsed);
    setIsDirty(false);
  };

  const handleExportCurrentFile = () => {
    const blob = new Blob([rawDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileElements = elements.filter((e) => e.fileName === activeFile);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left Project Folder Tree (.pgr files) */}
      <div
        className="w-60 border-r flex flex-col shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        <div
          className="px-3.5 py-2.5 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <FolderOpen className="w-3.5 h-3.5" style={{ color: 'var(--ctx-pos)' }} />
            <span>Файлы проекта (.pgr)</span>
          </div>
          <button
            type="button"
            onClick={() => setAddingFile((v) => !v)}
            className="p-1 rounded hover:opacity-80 cursor-pointer"
            title="Создать новый файл .pgr"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {addingFile && (
          <div
            className="p-2.5 border-b flex gap-1"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <input
              type="text"
              placeholder="world_rules.pgr"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="flex-1 px-2 py-1 rounded border text-xs font-mono-tabular"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
              }}
            />
            <button
              type="button"
              onClick={() => {
                const clean = newFileName.trim();
                if (!clean) return;
                const finalName = clean.endsWith('.pgr') ? clean : `${clean}.pgr`;
                onCreateFile(finalName);
                setNewFileName('');
                setAddingFile(false);
              }}
              className="px-2 py-1 rounded text-xs btn-ctx-pos cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {files.map((fileName) => {
            const count = elements.filter((e) => e.fileName === fileName).length;
            const isCurrent = fileName === activeFile;
            return (
              <button
                key={fileName}
                type="button"
                onClick={() => onSelectFile(fileName)}
                className="w-full px-2.5 py-2 rounded text-left text-xs flex items-center justify-between transition-colors cursor-pointer"
                style={{
                  backgroundColor: isCurrent ? 'var(--bg-subtle)' : 'transparent',
                  color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                <span className="flex items-center gap-2 truncate font-mono-tabular">
                  <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fileName}</span>
                </span>
                <span
                  className="text-[11px] font-mono-tabular"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Element Jump List by Line Range inside Current File */}
        <div
          className="border-t p-2.5 space-y-1.5 max-h-64 overflow-y-auto"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div
            className="text-[11px] font-medium px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Блоки и диапазоны строк в {activeFile}:
          </div>
          {ranges.map((r) => {
            const el = elements.find((e) => e.id === r.elementId);
            if (!el) return null;
            const isRangeActive =
              highlightedLineRange?.start === r.startLine &&
              highlightedLineRange?.end === r.endLine;
            return (
              <button
                key={r.elementId}
                type="button"
                onClick={() => {
                  onSelectElement(r.elementId);
                  onSetLineRange({ start: r.startLine, end: r.endLine });
                }}
                className="w-full px-2 py-1 rounded text-left text-[11px] flex items-center justify-between font-mono-tabular cursor-pointer"
                style={{
                  backgroundColor: isRangeActive
                    ? 'var(--ctx-pos-soft)'
                    : 'transparent',
                  color: isRangeActive ? 'var(--ctx-pos)' : 'var(--text-secondary)',
                }}
              >
                <span className="truncate">{el.id}</span>
                <span className="shrink-0 opacity-80">
                  L{r.startLine}–{r.endLine}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split IDE Viewport: Structured Blocks (Left) + Line-Range .pgr Code Viewer/Editor (Right) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* IDE Top Control Bar: Line-Range Selector + Quick Element Add + Export */}
        <div
          className="px-4 py-2 border-b flex items-center justify-between gap-3 flex-wrap text-xs"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-hairline)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono-tabular font-semibold">{activeFile}</span>
            <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              ·
            </span>
            <span className="font-mono-tabular" style={{ color: 'var(--text-muted)' }}>
              {totalLines} строк
            </span>

            {/* Line Range Opener (Requirement 3.2 & 3.3: открытие по диапазону строк) */}
            <div
              className="flex items-center gap-1.5 ml-3 pl-3 border-l"
              style={{ borderColor: 'var(--border-hairline)' }}
            >
              <Filter className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Строки:</span>
              <input
                type="number"
                min={1}
                max={totalLines}
                placeholder="от"
                value={rangeStartInput}
                onChange={(e) => setRangeStartInput(e.target.value)}
                className="w-14 px-1.5 py-0.5 rounded border text-xs font-mono-tabular"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              />
              <span>–</span>
              <input
                type="number"
                min={1}
                max={totalLines}
                placeholder="до"
                value={rangeEndInput}
                onChange={(e) => setRangeEndInput(e.target.value)}
                className="w-14 px-1.5 py-0.5 rounded border text-xs font-mono-tabular"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              />
              <button
                type="button"
                onClick={applyLineRangeFilter}
                className="px-2 py-0.5 rounded text-[11px] btn-ctx-pos-soft cursor-pointer"
              >
                Выделить
              </button>
              {highlightedLineRange && (
                <>
                  <label className="flex items-center gap-1 text-[11px] ml-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyShowRangeLines}
                      onChange={(e) => setOnlyShowRangeLines(e.target.checked)}
                    />
                    <span>Скрыть остальные</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onSetLineRange(null)}
                    className="text-[11px] underline ml-1 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Сброс
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isDirty && (
              <>
                <button
                  type="button"
                  onClick={handleSaveRawPgr}
                  className="px-2.5 py-1 rounded text-xs flex items-center gap-1 btn-ctx-pos cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Применить текст .pgr</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRawDraft(canonicalPgr);
                    setIsDirty(false);
                  }}
                  className="px-2 py-1 rounded text-xs flex items-center gap-1 btn-ctx-neg-soft cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Отмена</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleExportCurrentFile}
              className="px-2.5 py-1 rounded text-xs flex items-center gap-1.5 border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
              }}
              title="Скачать файл .pgr на диск"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать .pgr</span>
            </button>
          </div>
        </div>

        {/* Two-Column Body: Structured Block Cards + Line-Numbered .pgr Markup */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
          {/* Column 1: Visual Block Structure of File */}
          <div
            className="border-r overflow-y-auto p-4 space-y-3"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-xs font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                Структурные блоки файла ({fileElements.length})
              </span>
              <div className="flex items-center gap-1">
                {(['system', 'class', 'process', 'component', 'object', 'idea'] as ElementType[]).map(
                  (t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onCreateElementInFile(activeFile, t)}
                      className="px-1.5 py-0.5 rounded text-[11px] border flex items-center gap-1 cursor-pointer"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-hairline)',
                      }}
                      title={`Добавить ${TYPE_HEADERS_RU[t]} в ${activeFile}`}
                    >
                      <Plus
                        className="w-3 h-3"
                        style={{ color: ELEMENT_TYPE_ACCENTS[t] }}
                      />
                      <span>{TYPE_HEADERS_RU[t].slice(0, 4)}.</span>
                    </button>
                  )
                )}
              </div>
            </div>

            {fileElements.map((el) => {
              const range = ranges.find((r) => r.elementId === el.id);
              const isSelected = selectedElementId === el.id;
              const isAiPinned = aiContextIds.includes(el.id);
              const accent = el.customColor || ELEMENT_TYPE_ACCENTS[el.type];

              return (
                <div
                  key={el.id}
                  onClick={() => {
                    onSelectElement(el.id);
                    if (range) {
                      onSetLineRange({ start: range.startLine, end: range.endLine });
                    }
                  }}
                  className="p-3.5 rounded-lg border transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: isSelected ? accent : 'var(--border-hairline)',
                    borderLeftWidth: '3px',
                    borderLeftColor: accent,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div
                      className="flex items-center gap-1.5 text-[11px] font-mono-tabular"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: accent }}
                      >
                        <ElementTypeIcon type={el.type} className="w-3.5 h-3.5" />
                        {TYPE_HEADERS_RU[el.type]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{el.id}</span>
                      {range && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            строки {range.startLine}–{range.endLine}
                          </span>
                        </>
                      )}
                      {el.mvp && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            className="font-semibold"
                            style={{ color: 'var(--ctx-pos)' }}
                          >
                            MVP
                          </span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAiContext(el.id);
                      }}
                      className="p-1 rounded cursor-pointer"
                      style={{
                        color: isAiPinned ? 'var(--ctx-pos)' : 'var(--text-muted)',
                        backgroundColor: isAiPinned
                          ? 'var(--ctx-pos-soft)'
                          : 'transparent',
                      }}
                      title="Выделить в контекст ИИ"
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h4 className="text-sm font-semibold mb-1">{el.title}</h4>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {el.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Column 2: Line-Numbered .pgr Code View with Range Highlighting & Live Editing */}
          <div className="flex flex-col h-full overflow-hidden">
            <div
              className="px-4 py-2 border-b flex items-center justify-between text-[11px]"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
                color: 'var(--text-muted)',
              }}
            >
              <span>
                Разметка <code className="font-mono-tabular">.pgr</code> (строчно-стабильная для Git-диффов)
              </span>
              {highlightedLineRange && (
                <span
                  className="font-mono-tabular font-medium"
                  style={{ color: 'var(--ctx-pos)' }}
                >
                  Открыт диапазон: строки {highlightedLineRange.start}–
                  {highlightedLineRange.end}
                </span>
              )}
            </div>

            {/* Line-by-line interactive viewer + editable raw textarea toggle */}
            <div className="flex-1 grid grid-rows-2 overflow-hidden">
              {/* Top half: Line-numbered highlighted view */}
              <div
                className="overflow-y-auto p-3 font-mono-tabular text-xs leading-relaxed border-b"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                {lines.map((lineText, idx) => {
                  const lineNum = idx + 1;
                  const inRange =
                    highlightedLineRange &&
                    lineNum >= highlightedLineRange.start &&
                    lineNum <= highlightedLineRange.end;

                  if (onlyShowRangeLines && highlightedLineRange && !inRange) {
                    return null;
                  }

                  return (
                    <div
                      key={lineNum}
                      className="flex items-baseline gap-3 px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: inRange
                          ? 'var(--ctx-pos-soft)'
                          : 'transparent',
                        opacity:
                          highlightedLineRange && !inRange ? 0.45 : 1,
                      }}
                    >
                      <span
                        className="w-8 text-right select-none shrink-0 text-[11px]"
                        style={{
                          color: inRange
                            ? 'var(--ctx-pos)'
                            : 'var(--text-muted)',
                        }}
                      >
                        {lineNum}
                      </span>
                      <span className="whitespace-pre-wrap break-all">
                        {lineText || ' '}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Bottom half: Direct .pgr text editor for users who want manual .pgr input */}
              <div className="flex flex-col h-full overflow-hidden">
                <div
                  className="px-3 py-1.5 text-[11px] flex items-center justify-between"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>Ручное редактирование текста .pgr (опционально):</span>
                  <span>Блоки разделяются строкой ---</span>
                </div>
                <textarea
                  value={rawDraft}
                  onChange={(e) => {
                    setRawDraft(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                  className="flex-1 w-full p-3 font-mono-tabular text-xs leading-relaxed resize-none focus:outline-none"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
