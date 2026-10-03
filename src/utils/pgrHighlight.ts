export type PgrTokenKind = 'heading-marker' | 'heading-type' | 'field-name' | 'section' | 'separator';

export interface PgrToken {
  text: string;
  kind?: PgrTokenKind;
}

/**
 * Highlights only the visible structural forms consumed by the PGR parser.
 * Text is returned verbatim so callers can safely render malformed drafts.
 */
export function highlightPgrLine(line: string, inHeader = true): PgrToken[] {
  const tokens: PgrToken[] = [];
  const push = (text: string, kind?: PgrTokenKind) => {
    if (text) tokens.push(kind ? { text, kind } : { text });
  };

  if (/^\s*---\s*$/.test(line)) {
    push(line, 'separator');
    return tokens;
  }

  const heading = line.match(/^(\s*##\s*)([^:]+)(:\s*)(.*)$/);
  if (heading) {
    push(heading[1], 'heading-marker');
    push(heading[2], 'heading-type');
    push(heading[3], 'heading-marker');
    push(heading[4]);
    return tokens;
  }

  if (inHeader) {
    const field = line.match(/^(\s*)([a-z_]+)(:\s*)(.*)$/i);
    if (field) {
      push(field[1]);
      push(field[2], 'field-name');
      push(field[3], 'heading-marker');
      push(field[4]);
      return tokens;
    }
  }

  if (/^\s*(поля|методы|компоненты|использует|взаимодействует|шаги|интерфейс|внутренняя логика|значения|notes|аннотирует):\s*$/i.test(line)) {
    push(line, 'section');
    return tokens;
  }

  push(line);
  return tokens;
}

/** Tokenizes a complete source while following the parser's header boundary. */
export function highlightPgrSource(source: string): PgrToken[][] {
  let inHeader = true;
  let headerHasContent = false;
  return source.split(/\r\n|\n|\r/).map((line) => {
    if (/^\s*---\s*$/.test(line)) {
      inHeader = true;
      headerHasContent = false;
      return highlightPgrLine(line, false);
    }

    const isHeading = /^\s*##\s*[^:]+:\s*.*$/.test(line);
    const isHeaderField = /^\s*[a-z_]+:\s*.*$/i.test(line);
    const tokens = highlightPgrLine(line, inHeader);
    if (inHeader && isHeading) {
      headerHasContent = true;
    } else if (inHeader && isHeaderField) {
      headerHasContent = true;
    } else if (inHeader && !line.trim() && !headerHasContent) {
      // Keep leading blank lines in a draft from hiding the first block header.
    } else if (inHeader) {
      inHeader = false;
    }
    return tokens;
  });
}
