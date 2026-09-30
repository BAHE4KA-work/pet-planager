import {
  NegativePaletteKey,
  PlanElement,
  PositivePaletteKey,
  UnitLibraryItem,
} from '../types/planager';

export const POSITIVE_PALETTES: Record<
  PositivePaletteKey,
  {
    labelRu: string;
    labelEn: string;
    main: string;
    hover: string;
    soft: string;
    border: string;
    text: string;
    textDark: string;
  }
> = {
  emerald: {
    labelRu: 'Зелёный (по умолчанию)',
    labelEn: 'Green (Default)',
    main: '#15803D',
    hover: '#166534',
    soft: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.45)',
    text: '#15803D',
    textDark: '#4ade80',
  },
  violet: {
    labelRu: 'Фиолетовый',
    labelEn: 'Violet',
    main: '#6D28D9',
    hover: '#5B21B6',
    soft: 'rgba(167, 139, 250, 0.12)',
    border: 'rgba(167, 139, 250, 0.45)',
    text: '#6D28D9',
    textDark: '#a78bfa',
  },
  sapphire: {
    labelRu: 'Синий',
    labelEn: 'Blue',
    main: '#1D4ED8',
    hover: '#1E40AF',
    soft: 'rgba(96, 165, 250, 0.12)',
    border: 'rgba(96, 165, 250, 0.45)',
    text: '#1D4ED8',
    textDark: '#60a5fa',
  },
  teal: {
    labelRu: 'Бирюзовый',
    labelEn: 'Teal',
    main: '#0F766E',
    hover: '#115E59',
    soft: 'rgba(45, 212, 191, 0.12)',
    border: 'rgba(45, 212, 191, 0.45)',
    text: '#0F766E',
    textDark: '#2dd4bf',
  },
  amber: {
    labelRu: 'Янтарный',
    labelEn: 'Amber',
    main: '#B45309',
    hover: '#92400E',
    soft: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.45)',
    text: '#B45309',
    textDark: '#fbbf24',
  },
};

export const NEGATIVE_PALETTES: Record<
  NegativePaletteKey,
  {
    labelRu: string;
    labelEn: string;
    main: string;
    hover: string;
    soft: string;
    border: string;
    text: string;
    textDark: string;
  }
> = {
  crimson: {
    labelRu: 'Красный (по умолчанию)',
    labelEn: 'Red (Default)',
    main: '#B91C1C',
    hover: '#991B1B',
    soft: 'rgba(248, 113, 113, 0.12)',
    border: 'rgba(248, 113, 113, 0.45)',
    text: '#B91C1C',
    textDark: '#f87171',
  },
  rose: {
    labelRu: 'Розовый (Кармин)',
    labelEn: 'Rose',
    main: '#BE123C',
    hover: '#9F1239',
    soft: 'rgba(251, 113, 133, 0.12)',
    border: 'rgba(251, 113, 133, 0.45)',
    text: '#BE123C',
    textDark: '#fb7185',
  },
  ochre: {
    labelRu: 'Охра (Оранжевый)',
    labelEn: 'Ochre',
    main: '#C2410C',
    hover: '#9A3412',
    soft: 'rgba(251, 146, 60, 0.12)',
    border: 'rgba(251, 146, 60, 0.45)',
    text: '#C2410C',
    textDark: '#fb923c',
  },
  slate: {
    labelRu: 'Графитовый',
    labelEn: 'Slate',
    main: '#475569',
    hover: '#334155',
    soft: 'rgba(148, 163, 184, 0.14)',
    border: 'rgba(148, 163, 184, 0.45)',
    text: '#475569',
    textDark: '#94a3b8',
  },
  indigo: {
    labelRu: 'Индиго',
    labelEn: 'Indigo',
    main: '#4338CA',
    hover: '#3730A3',
    soft: 'rgba(129, 140, 248, 0.12)',
    border: 'rgba(129, 140, 248, 0.45)',
    text: '#4338CA',
    textDark: '#818cf8',
  },
};

export const INITIAL_FILES = [
  'sys_planager_core.pgr',
  'sys_canvas_engine.pgr',
  'sys_ai_assistant.pgr',
];

export const INITIAL_ELEMENTS: PlanElement[] = [
  // ================= FILE 1: sys_planager_core.pgr =================
  {
    id: 'sys_planager_core',
    type: 'system',
    title: 'PLANAGER Архитектура Платформы',
    fileName: 'sys_planager_core.pgr',
    parent: '-',
    description:
      'Главный управляющий контур платформы PLANAGER, координирующий графический Canvas, двусторонний PGR-кодек, локальное Git-версионирование и ИИ-ассистента.',
    status: 'черновик',
    mvp: true,
    position: { x: 40, y: 40 },
  },
  {
    id: 'cls_kb_editor',
    type: 'class',
    title: 'Редактор Базы Знаний',
    fileName: 'sys_planager_core.pgr',
    parent: 'sys_planager_core',
    extendsId: '-',
    description:
      'Управляющий класс для редактирования DSL-кода архитектуры в структурированном виде и в режиме сырого PGR-кода.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 40 },
    fields: [
      { name: 'activeFile', dataType: 'string', description: 'имя текущего открытого файла .pgr' },
      { name: 'editorMode', dataType: 'string', description: 'режим работы (structured или raw_pgr)' },
      { name: 'cursorLine', dataType: 'int', description: 'позиция курсора в редакторе' },
    ],
    methods: [
      { visibility: '+', signature: 'parseContent(content)', description: 'двухэтапный парсинг PGR синтаксиса' },
      { visibility: '+', signature: 'serializeElements(elements)', description: 'генерация канонического текста .pgr' },
      { visibility: '-', signature: 'validateAst(ast)', description: 'проверка ссылочной целостности графа' },
    ],
    components: ['cmp_pgr_parser', 'cmp_ast_validator'],
    uses: ['proc_save_pgr_file'],
  },
  {
    id: 'cmp_pgr_parser',
    type: 'component',
    title: 'Парсер PGR Синтаксиса',
    fileName: 'sys_planager_core.pgr',
    parent: 'sys_planager_core',
    description:
      'Высокоскоростной текстовый кодек для синтаксиса .pgr с поддержкой регулярных выражений и блочной разметки.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 40 },
    interfaceItems: [
      'serializeElementToPgr(el) — преобразование элемента в текстовый блок',
      'parsePgrFileContent(text) — парсинг файла в набор элементов',
    ],
    internalLogic: [
      'Поддерживает заголовки блоков (## Тип: Название), ключи id, parent, extends, instance_of и списки полей/методов',
    ],
  },
  {
    id: 'cmp_ast_validator',
    type: 'component',
    title: 'Валидатор Графа AST',
    fileName: 'sys_planager_core.pgr',
    parent: 'sys_planager_core',
    description:
      'Модуль проверки связей и ссылочной целостности графа элементов.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 180 },
    interfaceItems: [
      'buildAndValidateGraph(elements) — построение ребер графа',
      'checkContradictions(elements) — выявление логических конфликтов',
    ],
    internalLogic: [
      'Проверяет существование родительских узлов и классов экземпляров',
    ],
  },
  {
    id: 'proc_save_pgr_file',
    type: 'process',
    title: 'Сохранение PGR Файла',
    fileName: 'sys_planager_core.pgr',
    parent: 'sys_planager_core',
    description:
      'Последовательность шагов при записи изменений архитектурного элемента в файл .pgr.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 180 },
    steps: [
      'Сериализовать текущее дерево элементов в канонический синтаксис .pgr',
      'Рассчитать диапазон измененных строк',
      'Обновить виртуальный снимок в файловой системе',
      'Инкрементировать счётчик незафиксированных изменений Git',
    ],
    components: ['cmp_pgr_parser'],
    uses: ['cls_kb_editor'],
  },

  // ================= FILE 2: sys_canvas_engine.pgr =================
  {
    id: 'sys_canvas_engine',
    type: 'system',
    title: 'Движок Графического Холста',
    fileName: 'sys_canvas_engine.pgr',
    parent: '-',
    description:
      'Интерактивная двухмерная графическая подсистема для визуализации графа компонентов, связей и конфликтов на SVG-холсте.',
    status: 'черновик',
    mvp: true,
    position: { x: 40, y: 320 },
  },
  {
    id: 'cls_canvas_controller',
    type: 'class',
    title: 'Контроллер Холста',
    fileName: 'sys_canvas_engine.pgr',
    parent: 'sys_canvas_engine',
    extendsId: '-',
    description:
      'Главный класс управления панорамированием, масштабированием и интерактивными событиями Canvas.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 320 },
    fields: [
      { name: 'zoom', dataType: 'float', description: 'текущий уровень масштабирования (40%-200%)' },
      { name: 'panX', dataType: 'float', description: 'смещение по оси X' },
      { name: 'panY', dataType: 'float', description: 'смещение по оси Y' },
    ],
    methods: [
      { visibility: '+', signature: 'handleWheelZoom(delta, cursor)', description: 'масштабирование с привязкой к курсору' },
      { visibility: '+', signature: 'handlePan(dx, dy)', description: 'перемещение видимой области' },
      { visibility: '+', signature: 'toggleRelationVisibility(relType)', description: 'переключение видимости типов связей' },
    ],
    components: ['cmp_grid_alignment', 'cmp_multi_select'],
    uses: ['proc_drag_node'],
  },
  {
    id: 'obj_primary_canvas',
    type: 'object',
    title: 'Эталонный Холст Проекта',
    fileName: 'sys_canvas_engine.pgr',
    parent: 'sys_canvas_engine',
    instanceOf: 'cls_canvas_controller',
    description:
      'Экземпляр холста по умолчанию с предустановленным масштабом 100% и сеткой прилипания.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 320 },
    values: [
      { fieldName: 'zoom', value: '100' },
      { fieldName: 'panX', value: '20' },
      { fieldName: 'panY', value: '20' },
    ],
  },
  {
    id: 'cmp_grid_alignment',
    type: 'component',
    title: 'Прилипание к Сетке и Направляющие',
    fileName: 'sys_canvas_engine.pgr',
    parent: 'sys_canvas_engine',
    description:
      'Модуль выравнивания элементов по сетке и динамическим осям с порогом срабатывания 12px.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 460 },
    interfaceItems: [
      'snapThreshold: int — порог захвата магнитной направляющей',
      'alignmentGuides: object — активные горизонтальные и вертикальные оси',
    ],
    internalLogic: [
      'Рисует пунктирные индикаторы выравнивания при перемещении узла относительно соседей',
    ],
  },
  {
    id: 'cmp_multi_select',
    type: 'component',
    title: 'Мультивыделение и ИИ-Контекст',
    fileName: 'sys_canvas_engine.pgr',
    parent: 'sys_canvas_engine',
    description:
      'Система группового выбора элементов через Ctrl/Cmd + ЛКМ для формирования изолированного контекста для ИИ.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 460 },
    interfaceItems: [
      'selectedIds: string[] — массив идентификаторов выделенных узлов',
      'toggleNodeSelection(id) — переключение выделения узла',
    ],
    internalLogic: [
      'Передаёт список выбранных ID в ИИ-ассистент как приоритетный контекст анализа',
    ],
  },
  {
    id: 'proc_drag_node',
    type: 'process',
    title: 'Перемещение Узла Графа',
    fileName: 'sys_canvas_engine.pgr',
    parent: 'sys_canvas_engine',
    description:
      'Алгоритм перемещения одиночных элементов или выделенных групп по Canvas с фиксацией истории Ctrl+Z.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 600 },
    steps: [
      'Зафиксировать стартовые позиции элементов выделенной группы',
      'Рассчитать смещение курсора с учётом текущего масштаба CanvasZoom',
      'Вычислить координаты с прилипанием к сетке',
      'Обновить координаты и записать шаг в исторический стек MoveHistory',
    ],
    components: ['cmp_grid_alignment', 'cmp_multi_select'],
    uses: ['cls_canvas_controller'],
  },

  // ================= FILE 3: sys_ai_assistant.pgr =================
  {
    id: 'sys_ai_assistant',
    type: 'system',
    title: 'ИИ-Ассистент Архитектора',
    fileName: 'sys_ai_assistant.pgr',
    parent: '-',
    description:
      'Многоагентный ИИ-сервис платформы PLANAGER для анализа противоречий, генерации предложений, проведения интервью и контроля лимитов API.',
    status: 'черновик',
    mvp: true,
    position: { x: 40, y: 600 },
  },
  {
    id: 'cls_ai_manager',
    type: 'class',
    title: 'Менеджер ИИ-Модулей',
    fileName: 'sys_ai_assistant.pgr',
    parent: 'sys_ai_assistant',
    extendsId: '-',
    description:
      'Центральный класс взаимодействия с внешними нейросетевыми моделями и оркестрации специализированных попапов.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 600 },
    fields: [
      { name: 'apiEndpoint', dataType: 'string', description: 'URL прокси или прямого эндпоинта LLM' },
      { name: 'apiKey', dataType: 'string', description: 'зашифрованный API ключ' },
      { name: 'isAiEnabled', dataType: 'bool', description: 'флаг активности ИИ-функций' },
    ],
    methods: [
      { visibility: '+', signature: 'scanContradictions(elements)', description: 'поиск логических конфликтов в графе' },
      { visibility: '+', signature: 'generateProposals(context)', description: 'формирование архитектурных рекомендаций' },
      { visibility: '+', signature: 'transformElement(sourceId, pattern)', description: 'разворачивание элемента в многоуровневый каркас' },
    ],
    components: ['cmp_rate_limiter', 'cmp_contradiction_detector'],
    uses: ['proc_ai_request_cycle'],
  },
  {
    id: 'cmp_rate_limiter',
    type: 'component',
    title: 'Монитор Искусственных Лимитов',
    fileName: 'sys_ai_assistant.pgr',
    parent: 'sys_ai_assistant',
    description:
      'Подсистема контроля расхода ресурсов API по категориям RPM, RPD, TPM и TT.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 740 },
    interfaceItems: [
      'limits: { rpm, rpd, tpm, tt } — искусственные пороги ограничения',
      'currentUsage: { rpm, rpd, tpm, tt } — счетчик текущего расхода',
      'resetTotalTokens() — сброс накопительного счётчика токенов TT',
    ],
    internalLogic: [
      'Блокирует отправку запросов при превышении любого из порогов и ведёт почасовой график потребления',
    ],
  },
  {
    id: 'cmp_contradiction_detector',
    type: 'component',
    title: 'Детектор Противоречий',
    fileName: 'sys_ai_assistant.pgr',
    parent: 'sys_ai_assistant',
    description:
      'Алгоритмический и нейросетевой сканер несоответствий типов, дубликатов и циклических зависимостей.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 740 },
    interfaceItems: [
      'contradictions: AiContradiction[] — список обнаруженных конфликтов',
      'applyFix(fixPatch) — автоматическое применение патча исправления',
    ],
    internalLogic: [
      'Подсвечивает конфликтные ребра и узлы на Canvas красным цветом с возможностью разобрать конфликт в 1 клик',
    ],
  },
  {
    id: 'proc_ai_request_cycle',
    type: 'process',
    title: 'Цикл Выполнения Запроса ИИ',
    fileName: 'sys_ai_assistant.pgr',
    parent: 'sys_ai_assistant',
    description:
      'Полная последовательность обработки вызова к ИИ-ассистенту от генерации промпта до записи в журнал.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 880 },
    steps: [
      'Проверить искусственные лимиты RPM/RPD/TPM/TT через cmp_rate_limiter',
      'Сформировать системный промпт с учётом выделенного контекста элементов',
      'Отправить HTTP-запрос к эндпоинту модели',
      'Зафиксировать расход токенов, latency и статус в таблице истории использования',
    ],
    components: ['cmp_rate_limiter', 'cmp_contradiction_detector'],
    uses: ['cls_ai_manager'],
  },
  {
    id: 'idea_local_wasm_llm',
    type: 'idea',
    title: 'Локальная LLM в WebAssembly',
    fileName: 'sys_ai_assistant.pgr',
    parent: 'sys_ai_assistant',
    description:
      'Запуск лёгкой локальной модели непосредственно в браузере через WebAssembly/WebGPU для полной приватности кода.',
    status: 'черновик',
    mvp: false,
    position: { x: 540, y: 880 },
  },
];

// Initial reusable architecture templates persisted in workspace/workspace.json
export const INITIAL_UNIT_LIBRARY: UnitLibraryItem[] = [
  {
    unitId: 'unit_sys_inventory',
    category: 'Система · базовый контур хранения',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'sys_inventory_tpl',
      type: 'system',
      title: 'Инвентарь (Система)',
      parent: '-',
      description: 'Типовая система хранения предметов, слотов экипировки, веса и стеков.',
      status: 'черновик',
      mvp: true,
    },
  },
  {
    unitId: 'unit_sys_dialogue',
    category: 'Система · диалоги и проверки',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'sys_dialogue_tree',
      type: 'system',
      title: 'Диалоговая система (Система)',
      parent: '-',
      description: 'Система ветвящихся реплик НИП, проверок характеристик и памяти о выборах игрока.',
      status: 'черновик',
      mvp: true,
    },
  },
  {
    unitId: 'unit_cmp_durability',
    category: '2 интерфейса, 1 правило',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'cmp_durability',
      type: 'component',
      title: 'cmp_durability (Компонент)',
      parent: 'sys_inventory',
      description: 'Компонент прочности и износа предмета при использовании.',
      status: 'черновик',
      mvp: true,
      interfaceItems: [
        'current_durability: int — текущая прочность',
        'max_durability: int — максимальная прочность',
      ],
      internalLogic: ['Блокирует использование при прочности 0'],
    },
  },
  {
    unitId: 'unit_cmp_rarity',
    category: '1 интерфейс, 1 правило',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'cmp_rarity',
      type: 'component',
      title: 'cmp_rarity (Компонент редкости)',
      parent: 'sys_inventory',
      description: 'Определяет градацию ценности предмета и множитель характеристик.',
      status: 'черновик',
      mvp: true,
      interfaceItems: ['rarity_tier: string — обычное / редкое / реликт'],
      internalLogic: ['Повышает базовую стоимость при торговле'],
    },
  },
  {
    unitId: 'unit_cls_container',
    category: '2 поля, 1 метод, 1 компонент',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'cls_container',
      type: 'class',
      title: 'cls_container (Класс контейнера)',
      parent: 'sys_inventory',
      extendsId: '-',
      description: 'Базовый класс сундуков, сумок и мировых тайников.',
      status: 'черновик',
      mvp: true,
      fields: [
        { name: 'capacity', dataType: 'int', description: 'число слотов' },
        { name: 'is_locked', dataType: 'bool', description: 'заперт ли замок' },
      ],
      methods: [
        { visibility: '+', signature: 'open()', description: 'открыть контейнер' },
      ],
      components: ['cmp_durability'],
      uses: ['proc_pickup_item'],
    },
  },
  {
    unitId: 'unit_proc_craft',
    category: '3 шага процесса, 1 компонент',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'proc_craft_item',
      type: 'process',
      title: 'proc_craft_item (Процесс крафта)',
      parent: 'sys_inventory',
      description: 'Последовательность проверки рецепта, списания ресурсов и создания предмета.',
      status: 'черновик',
      mvp: false,
      steps: [
        'Проверить наличие ингредиентов в инвентаре',
        'Списать ресурсы из стеков',
        'Создать новый экземпляр предмета',
      ],
      components: ['cmp_stackable'],
      uses: ['cls_item', 'proc_pickup_item'],
    },
  },
  {
    unitId: 'unit_proc_trade',
    category: '3 шага процесса, 1 компонент',
    savedAt: 'Базовый шаблон .pgr',
    element: {
      id: 'proc_trade_barter',
      type: 'process',
      title: 'proc_trade_barter (Процесс обмена)',
      parent: 'sys_factions',
      description: 'Сделка обмена между инвентарём игрока и торговцем фракции.',
      status: 'черновик',
      mvp: false,
      steps: [
        'Рассчитать ценность корзины с учётом cmp_reputation_bound',
        'Проверить баланс золота сторон',
        'Переместить предметы через proc_pickup_item',
      ],
      components: ['cmp_reputation_bound'],
      uses: ['cls_item', 'proc_pickup_item'],
    },
  },
];

export function describeUnitStructure(
  el: Omit<PlanElement, 'fileName' | 'position'>,
  projectElements: PlanElement[]
): { structureLabel: string; usageCount: number } {
  const parts: string[] = [];
  if (el.fields && el.fields.length > 0) {
    parts.push(`${el.fields.length} пол.`);
  }
  if (el.methods && el.methods.length > 0) {
    parts.push(`${el.methods.length} мет.`);
  }
  if (el.steps && el.steps.length > 0) {
    parts.push(`${el.steps.length} шаг.`);
  }
  if (el.interfaceItems && el.interfaceItems.length > 0) {
    parts.push(`${el.interfaceItems.length} интерф.`);
  }
  if (el.internalLogic && el.internalLogic.length > 0) {
    parts.push(`${el.internalLogic.length} прав.`);
  }
  if (el.components && el.components.length > 0) {
    parts.push(`${el.components.length} комп.`);
  }
  if (el.values && el.values.length > 0) {
    parts.push(`${el.values.length} знач.`);
  }

  const baseId = el.id.replace(/_tpl$/, '');
  const usageCount = projectElements.filter(
    (pe) =>
      pe.id === el.id ||
      pe.id === baseId ||
      pe.parent === el.id ||
      pe.parent === baseId ||
      pe.extendsId === el.id ||
      pe.extendsId === baseId ||
      pe.instanceOf === el.id ||
      pe.instanceOf === baseId ||
      (pe.components || []).includes(el.id) ||
      (pe.components || []).includes(baseId) ||
      (pe.uses || []).includes(el.id) ||
      (pe.uses || []).includes(baseId)
  ).length;

  return {
    structureLabel: parts.length > 0 ? parts.join(', ') : el.mvp ? 'MVP-элемент' : 'Базовый блок',
    usageCount,
  };
}

export const I18N_DICTIONARY = {
  ru: {
    tabKb: 'База знаний',
    tabCanvas: 'Холст',
    tabLibrary: 'Библиотека юнитов',
    tabSettings: 'Настройки',
    aiBtn: 'ИИ-ассистент',
    projectFilesHeader: 'Файлы проекта',
    legendHeader: 'Легенда',
    categoriesHeader: 'Категории',
    sectionsHeader: 'Разделы',
    confirmYes: 'Да',
    confirmNo: 'Нет',
  },
  en: {
    tabKb: 'Knowledge Base',
    tabCanvas: 'Canvas',
    tabLibrary: 'Unit Library',
    tabSettings: 'Settings',
    aiBtn: 'AI Assistant',
    projectFilesHeader: 'Project Files',
    legendHeader: 'Legend',
    categoriesHeader: 'Categories',
    sectionsHeader: 'Sections',
    confirmYes: 'Yes',
    confirmNo: 'No',
  },
};
