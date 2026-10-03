import { useMemo, useRef, type CSSProperties } from 'react';
import type { PlanElement } from '../types/planager';
import { inspectGraphSchemaIssues } from '../utils/aiEngine';
import { parsePgrFileContent } from '../utils/pgrCodec';
import { localizePgrParseError } from '../utils/pgrErrorLocalization';
import { highlightPgrSource, type PgrTokenKind } from '../utils/pgrHighlight';

export interface PgrSourceEditorProps {
  value: string;
  onChange(value: string): void;
  fileName: string;
  existingElements?: PlanElement[];
  locale?: 'ru' | 'en';
  className?: string;
  ariaLabel?: string;
}

type Diagnostic = { severity: 'error' | 'warning'; message: string };

const colorByKind: Record<PgrTokenKind, string> = {
  'heading-marker': 'var(--accent)',
  'heading-type': 'var(--ctx-pos-text)',
  'field-name': 'var(--ctx-neg-text)',
  section: 'var(--accent)',
  separator: 'var(--ink-muted)',
};

const mirrorStyle: CSSProperties = {
  boxSizing: 'border-box',
  margin: 0,
  padding: '12px',
  border: '1px solid transparent',
  font: 'inherit',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '12px',
  lineHeight: '1.5',
  letterSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  tabSize: 2,
};

function getBlockStartLines(value: string): number[] {
  const lines = value.split(/\r\n|\n|\r/);
  const starts: number[] = [];
  let previousWasSeparator = false;
  lines.forEach((line, index) => {
    if (/^\s*---\s*$/.test(line)) {
      previousWasSeparator = true;
      return;
    }
    if (line.trim() && (starts.length === 0 || previousWasSeparator)) starts.push(index + 1);
    previousWasSeparator = false;
  });
  return starts;
}

function getSourceRanges(value: string): Map<string, { start: number; end: number }> {
  const lines = value.split(/\r\n|\n|\r/);
  const ranges = new Map<string, { start: number; end: number }>();
  let blockStart = 1;
  let blockId: string | null = null;
  const saveBlock = (end: number) => {
    if (blockId) ranges.set(blockId, { start: blockStart, end: Math.max(blockStart, end) });
    blockId = null;
  };
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^\s*---\s*$/.test(line)) {
      saveBlock(lineNumber - 1);
      blockStart = lineNumber + 1;
      return;
    }
    if (/^\s*##\s+[^:]+:\s*.+$/.test(line)) {
      if (blockId) saveBlock(lineNumber - 1);
      blockStart = lineNumber;
    }
    const id = line.match(/^\s*id:\s*(\S.*)\s*$/i);
    if (id) blockId = id[1].trim();
  });
  saveBlock(lines.length);
  return ranges;
}

function parseDiagnostics(error: unknown, value: string, fileName: string, locale: 'ru' | 'en'): Diagnostic[] {
  const message = localizePgrParseError(error instanceof Error ? error.message : String(error), locale);
  const block = message.match(/PGR block (\d+)/i);
  const blockLine = block ? getBlockStartLines(value)[Number(block[1]) - 1] : undefined;
  const lineText = blockLine
    ? locale === 'ru' ? `строка ${blockLine}` : `line ${blockLine}`
    : locale === 'ru' ? 'строка не определена' : 'line unavailable';
  return [{ severity: 'error', message: `${fileName}:${blockLine ?? '?'} (${lineText}) — ${message}` }];
}

export function PgrSourceEditor({
  value,
  onChange,
  fileName,
  existingElements = [],
  locale = 'ru',
  className = '',
  ariaLabel,
}: PgrSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const label = (en: string, ru: string) => locale === 'ru' ? ru : en;

  const analysis = useMemo(() => {
    try {
      const parsed = parsePgrFileContent(value, fileName, existingElements);
      const retained = existingElements.filter((element) => element.fileName !== fileName);
      const graph = [...retained, ...parsed];
      const files = [...new Set([...existingElements.map((element) => element.fileName), fileName])];
      const sourceRanges = getSourceRanges(value);
      const graphIssues = inspectGraphSchemaIssues(graph, files, locale);
      const diagnostics: Diagnostic[] = graphIssues.map((issue) => ({
        severity: issue.severity === 'high' ? 'error' : 'warning',
        message: `${(() => {
          const editedId = issue.elementIds.find((id) => parsed.some((element) => element.id === id));
          const range = editedId ? sourceRanges.get(editedId) : undefined;
          return range ? `${fileName}:${range.start}-${range.end}` : issue.fileCitation || fileName;
        })()}: ${issue.title}`,
      }));
      return { parsed, diagnostics, error: null as string | null };
    } catch (cause) {
      return {
        parsed: [] as PlanElement[],
        diagnostics: parseDiagnostics(cause, value, fileName, locale),
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [value, fileName, existingElements, locale]);

  const lines = value.split(/\r\n|\n|\r/);
  const highlightedLines = highlightPgrSource(value);
  const syncScroll = () => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (textarea && highlight) {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    }
  };

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div className="relative min-h-40 flex-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <pre
          ref={highlightRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden text-[var(--ink)]"
          style={mirrorStyle}
        >
          {lines.map((line, index) => (
            <span key={index}>
              {highlightedLines[index].map((token, tokenIndex) => (
                <span key={tokenIndex} style={token.kind ? { color: colorByKind[token.kind] } : undefined}>{token.text}</span>
              ))}
              {index < lines.length - 1 ? '\n' : ''}
            </span>
          ))}
        </pre>
        <textarea
          ref={textareaRef}
          aria-label={ariaLabel || label(`PGR source for ${fileName}`, `Исходный PGR-код файла ${fileName}`)}
          aria-describedby={`${fileName}-pgr-diagnostics`}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-[var(--ink)] selection:bg-[var(--accent)]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ ...mirrorStyle, color: 'transparent' }}
        />
      </div>
      <div id={`${fileName}-pgr-diagnostics`} aria-live="polite" className="space-y-1 text-xs">
        <p className={analysis.error ? 'text-[var(--ctx-neg-text)]' : 'text-[var(--ink-muted)]'}>
          {analysis.error
            ? label('PGR syntax error', 'Ошибка синтаксиса PGR')
            : label(`Parsed ${analysis.parsed.length} element${analysis.parsed.length === 1 ? '' : 's'}`, `Распознано элементов: ${analysis.parsed.length}`)}
        </p>
        {analysis.diagnostics.map((diagnostic, index) => (
          <p key={`${diagnostic.message}-${index}`} className={diagnostic.severity === 'error' ? 'text-[var(--ctx-neg-text)]' : 'text-[var(--ink-muted)]'}>
            {diagnostic.message}
          </p>
        ))}
        {!analysis.error && analysis.diagnostics.length === 0 ? (
          <p className="text-[var(--ctx-pos-text)]">{label('No graph issues found.', 'Проблем графа не обнаружено.')}</p>
        ) : null}
      </div>
    </div>
  );
}
