import type {
  ClassField,
  ClassMethod,
  DiffLine,
  ElementType,
  GraphEdge,
  ObjectFieldValue,
  PgrBlockRange,
  PlanElement,
} from '../types/planager';

export const TYPE_HEADERS_RU: Record<ElementType, string> = {
  system: 'Система',
  class: 'Класс',
  process: 'Процесс-функция',
  component: 'Компонент',
  object: 'Объект',
  idea: 'Идея-образ',
};

export const TYPE_PREFIXES: Record<ElementType, string> = {
  system: 'sys_',
  class: 'cls_',
  process: 'proc_',
  component: 'cmp_',
  object: 'obj_',
  idea: 'idea_',
};

const DESCRIPTION_SECTION_MARKERS = new Set([
  'поля:', 'методы:', 'компоненты:', 'использует:', 'взаимодействует:',
  'шаги:', 'интерфейс:', 'внутренняя логика:', 'значения:', 'notes:', 'аннотирует:',
]);

function escapeDescriptionLine(line: string): string {
  const match = line.match(/^(\s*)(.*?)(\s*)$/);
  if (!match) return line;
  const [, leading, body, trailing] = match;
  const escapedMarker = body.startsWith('\\') ? body.slice(1) : '';
  if (body === '---' || DESCRIPTION_SECTION_MARKERS.has(body.toLowerCase()) ||
      escapedMarker === '---' || DESCRIPTION_SECTION_MARKERS.has(escapedMarker.toLowerCase())) {
    return `${leading}\\${body}${trailing}`;
  }
  return line;
}

function unescapeDescriptionLine(line: string): string {
  const match = line.match(/^(\s*)(\\*)(---|Поля:|Методы:|Компоненты:|Использует:|Взаимодействует:|Шаги:|Интерфейс:|Внутренняя логика:|Значения:|notes:|аннотирует:)(\s*)$/i);
  if (!match) return line;
  const slashCount = match[2].length;
  return slashCount ? `${match[1]}${'\\'.repeat(slashCount - 1)}${match[3]}${match[4]}` : line;
}

/**
 * Serializes a single PlanElement into its canonical, line-stable .pgr block string.
 */
export function serializeElementToPgr(el: PlanElement): string {
  const lines: string[] = [];
  const typeLabel = TYPE_HEADERS_RU[el.type] || 'Элемент';
  lines.push(`## ${typeLabel}: ${el.title}`);
  lines.push(`id: ${el.id}`);

  if (el.type !== 'system') {
    lines.push(`parent: ${el.parent || '-'}`);
  }

  if (el.type === 'class') {
    lines.push(`extends: ${el.extendsId || '-'}`);
  }

  if (el.type === 'object') {
    lines.push(`instance_of: ${el.instanceOf || '-'}`);
  }

  if (el.status && el.status !== 'черновик') {
    lines.push(`status: ${el.status}`);
  } else {
    lines.push(`status: черновик`);
  }

  if (el.mvp) {
    lines.push(`mvp: да`);
  }

  if (el.customColor) {
    lines.push(`color: ${el.customColor}`);
  }

  if (el.originIdeaId) {
    lines.push(`origin: ${el.originIdeaId}`);
  }

  if (el.type === 'idea') {
    if (el.altTo && el.altTo !== '-') {
      lines.push(`alt_to: ${el.altTo}`);
    }
    if (el.altReason && el.altReason.trim()) {
      lines.push(`alt_reason: ${el.altReason.trim()}`);
    }
  }

  lines.push('');
  lines.push(...(el.description.trim() || 'Описание не задано.').split('\n').map(escapeDescriptionLine));

  if (el.type === 'class') {
    if (el.fields && el.fields.length > 0) {
      lines.push('');
      lines.push('Поля:');
      for (const f of el.fields) {
        lines.push(`- ${f.name}: ${f.dataType} — ${f.description}`);
      }
    }
    if (el.methods && el.methods.length > 0) {
      lines.push('');
      lines.push('Методы:');
      for (const m of el.methods) {
        lines.push(`${m.visibility} ${m.signature} — ${m.description}`);
      }
    }
    if (el.components && el.components.length > 0) {
      lines.push('');
      lines.push('Компоненты:');
      for (const c of el.components) {
        lines.push(`- ${c}`);
      }
    }
    if (el.uses && el.uses.length > 0) {
      lines.push('');
      lines.push('Использует:');
      for (const u of el.uses) {
        lines.push(`- ${u}`);
      }
    }
  }

  if (el.type === 'process') {
    if (el.steps && el.steps.length > 0) {
      lines.push('');
      lines.push('Шаги:');
      el.steps.forEach((step, idx) => {
        lines.push(`${idx + 1}. ${step}`);
      });
    }
    if (el.components && el.components.length > 0) {
      lines.push('');
      lines.push('Компоненты:');
      for (const c of el.components) {
        lines.push(`- ${c}`);
      }
    }
    if (el.uses && el.uses.length > 0) {
      lines.push('');
      lines.push('Взаимодействует:');
      for (const u of el.uses) {
        lines.push(`- ${u}`);
      }
    }
  }

  if (el.type === 'component') {
    if (el.components && el.components.length > 0) {
      lines.push('');
      lines.push('Компоненты:');
      for (const c of el.components) lines.push(`- ${c}`);
    }
    if (el.interfaceItems && el.interfaceItems.length > 0) {
      lines.push('');
      lines.push('Интерфейс:');
      for (const item of el.interfaceItems) {
        lines.push(`+ ${item}`);
      }
    }
    if (el.internalLogic && el.internalLogic.length > 0) {
      lines.push('');
      lines.push('Внутренняя логика:');
      for (const logic of el.internalLogic) {
        lines.push(`- ${logic}`);
      }
    }
  }

  if (el.type === 'object') {
    if (el.components && el.components.length > 0) {
      lines.push('');
      lines.push('Компоненты:');
      for (const c of el.components) {
        lines.push(`- ${c}`);
      }
    }
    if (el.values && el.values.length > 0) {
      lines.push('');
      lines.push('Значения:');
      for (const v of el.values) {
        lines.push(`- ${v.fieldName}: ${v.value}`);
      }
    }
  }

  if (el.type === 'idea') {
    lines.push('');
    lines.push('notes:');
    if (el.notes && el.notes.length > 0) {
      for (const n of el.notes) {
        lines.push(`- ${n}`);
      }
    } else {
      lines.push(`- -`);
    }
  }

  return lines.join('\n');
}

/**
 * Serializes all elements belonging to a file into full .pgr text and returns exact 1-based line ranges for each element.
 */
export function serializeFileWithRanges(
  elements: PlanElement[],
  fileName: string
): { content: string; ranges: PgrBlockRange[] } {
  const fileElements = elements.filter((e) => e.fileName === fileName);
  if (fileElements.length === 0) {
    return { content: '', ranges: [] };
  }

  const ranges: PgrBlockRange[] = [];
  const fullLines: string[] = [];

  fileElements.forEach((el, index) => {
    if (index > 0) {
      fullLines.push('');
      fullLines.push('---');
      fullLines.push('');
    }
    const startLine = fullLines.length + 1;
    const rawBlock = serializeElementToPgr(el);
    const blockLines = rawBlock.split('\n');
    fullLines.push(...blockLines);
    const endLine = fullLines.length;

    ranges.push({
      elementId: el.id,
      fileName,
      startLine,
      endLine,
      rawText: rawBlock,
    });
  });

  return {
    content: fullLines.join('\n'),
    ranges,
  };
}

/**
 * Parses a raw .pgr file string back into PlanElement objects, preserving positions from existing elements when matching by ID.
 */
export function parsePgrFileContent(
  rawText: string,
  fileName: string,
  existingElements: PlanElement[]
): PlanElement[] {
  const blocks = rawText
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*---\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const parsedElements: PlanElement[] = [];
  const ids = new Set<string>();
  const typeByHeader = new Map(Object.entries(TYPE_HEADERS_RU).map(([type, label]) => [label.toLowerCase(), type as ElementType]));
  const prefixByType: Record<ElementType, RegExp> = {
    system: /^sys_[A-Za-z0-9_-]+$/, class: /^cls_[A-Za-z0-9_-]+$/,
    process: /^proc_[A-Za-z0-9_-]+$/, component: /^cmp_[A-Za-z0-9_-]+$/,
    object: /^obj_[A-Za-z0-9_-]+$/, idea: /^idea_[A-Za-z0-9_-]+$/,
  };

  blocks.forEach((block, blockIdx) => {
    const lines = block.split('\n');
    const headerLine = lines[0]?.trim() || '';
    const headerMatch = headerLine.match(/^##\s*([^:]+):\s*(.+)$/);

    if (!headerMatch) throw new Error(`PGR block ${blockIdx + 1}: неверный заголовок элемента`);
    const type = typeByHeader.get(headerMatch[1].trim().toLowerCase());
    if (!type) throw new Error(`PGR block ${blockIdx + 1}: неподдерживаемый тип "${headerMatch[1].trim()}"`);
    const title = headerMatch[2].trim();
    if (!title) throw new Error(`PGR block ${blockIdx + 1}: пустой заголовок`);

    let id = '';
    let parent = '-';
    let extendsId = '-';
    let instanceOf = '-';
    let mvp = false;
    let status: PlanElement['status'] = 'черновик';
    let customColor: string | undefined;
    let originIdeaId: string | undefined;
    let altTo: string | undefined;
    let altReason: string | undefined;

    const descriptionLines: string[] = [];
    const fields: ClassField[] = [];
    const methods: ClassMethod[] = [];
    const components: string[] = [];
    const uses: string[] = [];
    const steps: string[] = [];
    const interfaceItems: string[] = [];
    const internalLogic: string[] = [];
    const values: ObjectFieldValue[] = [];
    const notes: string[] = [];

    let currentSection:
      | 'header'
      | 'description'
      | 'fields'
      | 'methods'
      | 'components'
      | 'uses'
      | 'steps'
      | 'interface'
      | 'internal'
      | 'values'
      | 'notes' = 'header';
    const headerKeys = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (currentSection === 'header') {
        if (trimmed === '') {
          currentSection = 'description';
          continue;
        }
        const kv = trimmed.match(/^([a-z_]+):\s*(.*)$/i);
        if (kv) {
          const key = kv[1].toLowerCase();
          const val = kv[2].trim();
          if (headerKeys.has(key)) throw new Error(`PGR block ${blockIdx + 1}: повторяющееся поле заголовка "${key}"`);
          headerKeys.add(key);
          const allowedForType: Record<ElementType, string[]> = {
            system: ['id', 'status', 'mvp', 'color', 'origin'],
            class: ['id', 'parent', 'extends', 'status', 'mvp', 'color', 'origin'],
            process: ['id', 'parent', 'status', 'mvp', 'color', 'origin'],
            component: ['id', 'parent', 'status', 'mvp', 'color', 'origin'],
            object: ['id', 'parent', 'instance_of', 'status', 'mvp', 'color', 'origin'],
            idea: ['id', 'parent', 'status', 'mvp', 'color', 'origin', 'alt_to', 'alt_reason', 'notes'],
          };
          if (!allowedForType[type].includes(key)) {
            throw new Error(`PGR block ${blockIdx + 1}: поле заголовка "${key}" не поддерживается для типа ${type}`);
          }
          if (key === 'id') id = val;
          else if (key === 'parent') parent = val || '-';
          else if (key === 'extends') extendsId = val || '-';
          else if (key === 'instance_of') instanceOf = val || '-';
          else if (key === 'status') {
            if (val !== 'черновик') throw new Error(`PGR block ${blockIdx + 1}: неподдерживаемый status "${val}"`);
            status = val;
          }
          else if (key === 'mvp') {
            if (!['да', 'нет', 'true', 'false'].includes(val.toLowerCase())) {
              throw new Error(`PGR block ${blockIdx + 1}: неверное значение mvp "${val}" (ожидается да/нет)`);
            }
            mvp = val.toLowerCase() === 'да' || val.toLowerCase() === 'true';
          }
          else if (key === 'color') customColor = val;
          else if (key === 'origin') originIdeaId = val;
          else if (key === 'alt_to') altTo = val;
          else if (key === 'alt_reason') altReason = val;
          else if (!['id', 'parent', 'extends', 'instance_of', 'status', 'mvp', 'color', 'origin', 'alt_to', 'alt_reason', 'notes'].includes(key)) {
            throw new Error(`PGR block ${blockIdx + 1}: неизвестное поле заголовка "${key}"`);
          }
          else if (key === 'notes') {
            currentSection = 'notes';
          }
          continue;
        } else {
          currentSection = 'description';
        }
      }

      const lower = trimmed.toLowerCase();
      if (lower === 'поля:') {
        currentSection = 'fields';
        continue;
      }
      if (lower === 'методы:') {
        currentSection = 'methods';
        continue;
      }
      if (lower === 'компоненты:') {
        currentSection = 'components';
        continue;
      }
      if (lower === 'использует:' || lower === 'взаимодействует:') {
        currentSection = 'uses';
        continue;
      }
      if (lower === 'шаги:') {
        currentSection = 'steps';
        continue;
      }
      if (lower === 'интерфейс:') {
        currentSection = 'interface';
        continue;
      }
      if (lower === 'внутренняя логика:') {
        currentSection = 'internal';
        continue;
      }
      if (lower === 'значения:') {
        currentSection = 'values';
        continue;
      }
      if (lower === 'notes:' || lower === 'аннотирует:') {
        currentSection = 'notes';
        continue;
      }

      if (currentSection === 'description') {
        descriptionLines.push(unescapeDescriptionLine(line));
      } else if (currentSection === 'fields' && trimmed.startsWith('-')) {
        const body = trimmed.replace(/^-\s*/, '');
        const separator = body.indexOf(' — ');
        const fieldParts = separator >= 0 ? body.slice(0, separator).match(/^([^:]+):\s*(.*)$/) : null;
        if (fieldParts) {
          fields.push({
            name: fieldParts[1].trim(),
            dataType: fieldParts[2].trim(),
            description: body.slice(separator + 3),
          });
        } else {
          const simpleMatch = body.match(/^([^:]+):\s*(.+)$/);
          if (simpleMatch) {
            fields.push({
              name: simpleMatch[1].trim(),
              dataType: simpleMatch[2].trim(),
              description: 'Поле данных',
            });
          }
        }
      } else if (currentSection === 'methods' && (trimmed.startsWith('+') || trimmed.startsWith('-'))) {
        const vis = trimmed.startsWith('+') ? '+' : '-';
        const body = trimmed.slice(1).trim();
        const separator = body.indexOf(' — ');
        if (separator >= 0) {
          methods.push({
            visibility: vis,
            signature: body.slice(0, separator),
            description: body.slice(separator + 3),
          });
        } else {
          methods.push({
            visibility: vis,
            signature: body,
            description: vis === '+' ? 'публичный метод' : 'приватный метод',
          });
        }
      } else if (currentSection === 'components' && trimmed.startsWith('-')) {
        const val = trimmed.replace(/^-\s*/, '').trim();
        if (val && val !== '-') components.push(val);
      } else if (currentSection === 'uses' && trimmed.startsWith('-')) {
        const val = trimmed.replace(/^-\s*/, '').trim();
        if (val && val !== '-') uses.push(val);
      } else if (currentSection === 'steps' && /^\d+\./.test(trimmed)) {
        const val = trimmed.replace(/^\d+\.\s*/, '').trim();
        if (val) steps.push(val);
      } else if (currentSection === 'interface' && (trimmed.startsWith('+') || trimmed.startsWith('-'))) {
        const val = trimmed.slice(1).trim();
        if (val) interfaceItems.push(val);
      } else if (currentSection === 'internal' && (trimmed.startsWith('-') || trimmed.startsWith('+'))) {
        const val = trimmed.slice(1).trim();
        if (val) internalLogic.push(val);
      } else if (currentSection === 'values' && trimmed.startsWith('-')) {
        const body = trimmed.replace(/^-\s*/, '');
        const vMatch = body.match(/^([^:]+):(?:\s(.*))?$/);
        if (vMatch) {
          values.push({
            fieldName: vMatch[1].trim(),
            value: vMatch[2] ?? '',
          });
        }
      } else if (currentSection === 'notes' && trimmed.startsWith('-')) {
        const val = trimmed.replace(/^-\s*/, '').trim();
        if (val && val !== '-') notes.push(val);
      }
    }

    if (!id || !prefixByType[type].test(id)) throw new Error(`PGR block ${blockIdx + 1}: отсутствует или неверный ID для типа ${type}`);
    if (ids.has(id)) throw new Error(`PGR block ${blockIdx + 1}: дублирующийся ID ${id}`);
    ids.add(id);

    const existing = existingElements.find((e) => e.id === id);

    parsedElements.push({
      id,
      type,
      title,
      fileName,
      parent: type === 'system' ? '-' : parent,
      description: descriptionLines.join('\n').trim(),
      status,
      mvp,
      customColor,
      originIdeaId,
      position: existing?.position || {
        x: 120 + (blockIdx % 3) * 340,
        y: 120 + Math.floor(blockIdx / 3) * 240,
      },
      extendsId: type === 'class' ? extendsId : undefined,
      fields: type === 'class' ? fields : undefined,
      methods: type === 'class' ? methods : undefined,
      components: ['class', 'process', 'component', 'object'].includes(type) ? components : undefined,
      uses: ['class', 'process'].includes(type) ? uses : undefined,
      steps: type === 'process' ? steps : undefined,
      interfaceItems: type === 'component' ? interfaceItems : undefined,
      internalLogic: type === 'component' ? internalLogic : undefined,
      instanceOf: type === 'object' ? instanceOf : undefined,
      values: type === 'object' ? values : undefined,
      notes: type === 'idea' ? notes : undefined,
      altTo: type === 'idea' ? altTo : undefined,
      altReason: type === 'idea' ? altReason : undefined,
    });
  });

  return parsedElements;
}

/**
 * Resolves all inherited fields for an Object ('obj_') from its Class ('instance_of' + class 'extends' chain)
 * AND from its attached Components ('has' -> cmp_*).
 */
export function resolveInheritedFieldsForObject(
  objElement: PlanElement,
  allElements: PlanElement[]
): {
  fieldName: string;
  dataType: string;
  sourceId: string;
  sourceTitle: string;
  defaultDescription: string;
}[] {
  if (objElement.type !== 'object') return [];

  const result: {
    fieldName: string;
    dataType: string;
    sourceId: string;
    sourceTitle: string;
    defaultDescription: string;
  }[] = [];

  const visitedClasses = new Set<string>();
  let currentClassId = objElement.instanceOf;

  // 1. Traverse class inheritance chain (instance_of -> extends)
  while (currentClassId && currentClassId !== '-' && !visitedClasses.has(currentClassId)) {
    visitedClasses.add(currentClassId);
    const cls = allElements.find((e) => e.id === currentClassId && e.type === 'class');
    if (!cls) break;

    for (const f of cls.fields || []) {
      if (!result.some((r) => r.fieldName === f.name)) {
        result.push({
          fieldName: f.name,
          dataType: f.dataType,
          sourceId: cls.id,
          sourceTitle: cls.title,
          defaultDescription: f.description,
        });
      }
    }
    currentClassId = cls.extendsId;
  }

  // 2. Collect components from both the Object itself AND inherited classes
  const componentIds = new Set<string>(objElement.components || []);
  visitedClasses.forEach((clsId) => {
    const cls = allElements.find((e) => e.id === clsId);
    (cls?.components || []).forEach((cid) => componentIds.add(cid));
  });

  componentIds.forEach((cmpId) => {
    const cmp = allElements.find((e) => e.id === cmpId && e.type === 'component');
    if (!cmp) return;
    (cmp.interfaceItems || []).forEach((item) => {
      // Extract property-like interface declarations (e.g. "max_durability: int — макс. прочность" or "stack_limit: int")
      const propMatch = item.match(/^([a-zA-Z0-9_]+)\s*:\s*([^\s—-]+)(?:\s*[—-]\s*(.+))?$/);
      if (propMatch && !result.some((r) => r.fieldName === propMatch[1])) {
        result.push({
          fieldName: propMatch[1],
          dataType: propMatch[2],
          sourceId: cmp.id,
          sourceTitle: cmp.title,
          defaultDescription: propMatch[3] || `Из компонента ${cmp.title}`,
        });
      }
    });
  });

  return result;
}

/**
 * Builds all directed graph edges according to the 6 relation rules in Section 1 and validates constraints.
 */
export function buildAndValidateGraph(elements: PlanElement[]): {
  edges: GraphEdge[];
  warnings: { elementId: string; message: string }[];
} {
  const edges: GraphEdge[] = [];
  const warnings: { elementId: string; message: string }[] = [];
  const byId = new Map<string, PlanElement>();
  elements.forEach((e) => {
    if (byId.has(e.id)) {
      warnings.push({ elementId: e.id, message: `Дублирующийся ID элемента ${e.id}` });
    } else {
      byId.set(e.id, e);
    }
  });

  // Helper to check 'extends' cycle
  function hasExtendsCycle(startId: string): boolean {
    const seen = new Set<string>();
    let curr: string | undefined = startId;
    while (curr && curr !== '-') {
      if (seen.has(curr)) return true;
      seen.add(curr);
      const el = byId.get(curr);
      curr = el?.type === 'class' ? el.extendsId : undefined;
    }
    return false;
  }

  for (const el of elements) {
    if (el.altTo && el.altTo !== '-') {
      const target = byId.get(el.altTo);
      if (el.type !== 'idea' || !target) {
        warnings.push({ elementId: el.id, message: `alt_to ссылается на неизвестный элемент ${el.altTo}` });
      }
    }

    if (el.originIdeaId) {
      const origin = byId.get(el.originIdeaId);
      if (!origin || origin.type !== 'idea') {
        warnings.push({ elementId: el.id, message: `origin ссылается на неизвестную идею ${el.originIdeaId}` });
      }
    }

    // 1. contains: Система -> любой элемент (parent: sys_*)
    if (el.type !== 'system' && el.parent && el.parent !== '-') {
      const parentEl = byId.get(el.parent);
      const isValid = !!parentEl && parentEl.type === 'system';
      edges.push({
        id: `edge_contains_${el.parent}_${el.id}`,
        source: el.parent,
        target: el.id,
        relation: 'contains',
        valid: isValid,
        validationMessage: isValid ? undefined : `Родитель ${el.parent} не найден или не является Системой`,
      });
      if (!isValid) {
        warnings.push({
          elementId: el.id,
          message: `Некорректный parent: ${el.parent} (ожидается существующая Система sys_*)`,
        });
      }
    }

    // 2. extends: Класс -> Класс (single inheritance, no cycles)
    if (el.type === 'class' && el.extendsId && el.extendsId !== '-') {
      const targetCls = byId.get(el.extendsId);
      const cycle = hasExtendsCycle(el.id);
      const isValid = !!targetCls && targetCls.type === 'class' && !cycle;
      edges.push({
        id: `edge_extends_${el.id}_${el.extendsId}`,
        source: el.id,
        target: el.extendsId,
        relation: 'extends',
        valid: isValid,
        validationMessage: cycle
          ? 'Обнаружен цикл наследования extends!'
          : !targetCls
          ? `Базовый класс ${el.extendsId} не найден`
          : undefined,
      });
      if (!isValid) {
        warnings.push({
          elementId: el.id,
          message: cycle
            ? `Цикл наследования в extends у класса ${el.id}`
            : `extends ссылается на несуществующий класс ${el.extendsId}`,
        });
      }
    }

    // 3. instance_of: Объект -> Класс (0 or 1)
    if (el.type === 'object' && el.instanceOf && el.instanceOf !== '-') {
      const targetCls = byId.get(el.instanceOf);
      const isValid = !!targetCls && targetCls.type === 'class';
      edges.push({
        id: `edge_instance_${el.id}_${el.instanceOf}`,
        source: el.id,
        target: el.instanceOf,
        relation: 'instance_of',
        valid: isValid,
        validationMessage: isValid ? undefined : `Класс ${el.instanceOf} не найден`,
      });
      if (!isValid) {
        warnings.push({
          elementId: el.id,
          message: `instance_of ссылается на неизвестный класс ${el.instanceOf}`,
        });
      }
    }

    // 4. has: Класс/Процесс/Компонент/Объект -> Компонент
    if (['class', 'process', 'component', 'object'].includes(el.type)) {
      for (const cmpId of el.components || []) {
        const targetCmp = byId.get(cmpId);
        const isValid = !!targetCmp && targetCmp.type === 'component';
        edges.push({
          id: `edge_has_${el.id}_${cmpId}`,
          source: el.id,
          target: cmpId,
          relation: 'has',
          valid: isValid,
          validationMessage: isValid ? undefined : `Компонент ${cmpId} не найден`,
        });
        if (!isValid) warnings.push({ elementId: el.id, message: `has ссылается на неизвестный компонент ${cmpId}` });
      }
    }

    // 5. uses: Процесс-функция (или Класс) -> любой элемент
    if (['process', 'class'].includes(el.type)) {
      for (const targetId of el.uses || []) {
        const targetEl = byId.get(targetId);
        const isValid = !!targetEl;
        edges.push({
          id: `edge_uses_${el.id}_${targetId}`,
          source: el.id,
          target: targetId,
          relation: 'uses',
          valid: isValid,
          validationMessage: isValid ? undefined : `Целевой элемент ${targetId} не найден`,
        });
        if (!isValid) warnings.push({ elementId: el.id, message: `uses ссылается на неизвестный элемент ${targetId}` });
      }
    }

    // 6. notes: Идея-образ -> любой элемент
    if (el.type === 'idea') {
      for (const noteTargetId of el.notes || []) {
        if (noteTargetId === '-') continue;
        const targetEl = byId.get(noteTargetId);
        const isValid = !!targetEl;
        edges.push({
          id: `edge_notes_${el.id}_${noteTargetId}`,
          source: el.id,
          target: noteTargetId,
          relation: 'notes',
          valid: isValid,
          validationMessage: isValid ? undefined : `Целевой элемент ${noteTargetId} не найден`,
        });
        if (!isValid) warnings.push({ elementId: el.id, message: `notes ссылается на неизвестный элемент ${noteTargetId}` });
      }
    }
  }

  return { edges, warnings };
}

/**
 * Computes a clean line-by-line diff between two .pgr file strings for Git versioning view.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText ? oldText.replace(/\r\n?/g, '\n').split('\n') : [];
  const newLines = newText ? newText.replace(/\r\n?/g, '\n').split('\n') : [];

  // LCS matrix for accurate, minimal git-like diffs
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNum = 1;
  let newNum = 1;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      diff.push({
        type: 'unchanged',
        oldLineNumber: oldNum++,
        newLineNumber: newNum++,
        content: oldLines[i],
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({
        type: 'removed',
        oldLineNumber: oldNum++,
        content: oldLines[i],
      });
      i++;
    } else {
      diff.push({
        type: 'added',
        newLineNumber: newNum++,
        content: newLines[j],
      });
      j++;
    }
  }

  while (i < m) {
    diff.push({
      type: 'removed',
      oldLineNumber: oldNum++,
      content: oldLines[i++],
    });
  }

  while (j < n) {
    diff.push({
      type: 'added',
      newLineNumber: newNum++,
      content: newLines[j++],
    });
  }

  return diff;
}
