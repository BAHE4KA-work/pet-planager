import type { PlanElement } from '../types/planager.ts';
import { parsePgrFileContent } from '../utils/pgrCodec.ts';

export interface PreparedSourceImport {
  path: string;
  content: string;
  elements: PlanElement[];
  diagnostic: string | null;
}

function sourceFileName(name: string): string {
  const leaf = name.trim().replace(/\\/g, '/').split('/').at(-1)?.trim() || '';
  if (!leaf || leaf === '.' || leaf === '..' || !leaf.toLowerCase().endsWith('.pgr')) {
    throw new Error('Choose a .pgr file with a valid filename.');
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(leaf) || /[ .]$/.test(leaf)) {
    throw new Error(`Cannot import "${leaf}": the filename is not valid in this workspace.`);
  }
  const stem = leaf.slice(0, leaf.lastIndexOf('.')).toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
    throw new Error(`Cannot import "${leaf}": the filename is reserved by the operating system.`);
  }
  return leaf;
}

function uniqueImportPath(name: string, existingFiles: string[]): string {
  const leaf = sourceFileName(name);
  const occupied = new Set(existingFiles.map((path) => path.toLocaleLowerCase('en-US')));
  if (!occupied.has(leaf.toLocaleLowerCase('en-US'))) return leaf;
  const extension = leaf.slice(leaf.lastIndexOf('.'));
  const stem = leaf.slice(0, -extension.length);
  let suffix = 1;
  let candidate = `${stem}_import${suffix}${extension}`;
  while (occupied.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${stem}_import${++suffix}${extension}`;
  }
  return candidate;
}

/** Parse an imported file without changing project state; malformed text remains available for repair. */
export function prepareSourceImport(
  name: string,
  content: string,
  existingFiles: string[],
  currentElements: PlanElement[],
): PreparedSourceImport {
  const path = uniqueImportPath(name, existingFiles);
  let elements: PlanElement[];
  try {
    elements = parsePgrFileContent(content, path, []);
  } catch (cause) {
    return {
      path,
      content,
      elements: [],
      diagnostic: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const existingIds = new Set(currentElements.map((element) => element.id));
  const duplicate = elements.find((element) => existingIds.has(element.id));
  if (duplicate) {
    throw new Error(`Cannot import ${path}: element ID "${duplicate.id}" already exists in this project.`);
  }
  return { path, content, elements, diagnostic: null };
}
