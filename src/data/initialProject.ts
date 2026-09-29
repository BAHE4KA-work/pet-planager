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
  'sys_inventory.pgr',
  'sys_factions.pgr',
  'idea_backlog.pgr',
];

export const INITIAL_ELEMENTS: PlanElement[] = [
  // ================= FILE 1: sys_inventory.pgr (7 elements) =================
  {
    id: 'sys_inventory',
    type: 'system',
    title: 'Система инвентаря',
    fileName: 'sys_inventory.pgr',
    parent: '-',
    description:
      'Сборник правил хранения, веса, стекирования и износа предметов персонажа и контейнеров.',
    status: 'черновик',
    mvp: true,
    position: { x: 40, y: 40 },
  },
  {
    id: 'cls_item',
    type: 'class',
    title: 'Предмет',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    extendsId: '-',
    description:
      'Базовый объект инвентаря: любая вещь, которую можно подобрать, использовать или сложить в стек.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 40 },
    fields: [
      { name: 'name', dataType: 'string', description: 'отображаемое имя' },
      { name: 'weight', dataType: 'float', description: 'вес в кг' },
    ],
    methods: [
      { visibility: '+', signature: 'use()', description: 'публичный, применить предмет' },
      { visibility: '-', signature: 'validate()', description: 'приватный, проверка целостности' },
    ],
    components: ['cmp_durability', 'cmp_stackable'],
    uses: ['proc_pickup_item'],
  },
  {
    id: 'obj_sword_excalibur',
    type: 'object',
    title: 'Меч Экскалибур',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    instanceOf: 'cls_item',
    description:
      'Эталонный экземпляр уникального оружия для проверки переопределения полей веса и прочности.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 40 },
    components: ['cmp_durability'],
    values: [
      { fieldName: 'name', value: '"Экскалибур"' },
      { fieldName: 'weight', value: '3.2' },
      { fieldName: 'current_durability', value: '100' },
      { fieldName: 'max_durability', value: '100' },
    ],
  },
  {
    id: 'cmp_durability',
    type: 'component',
    title: 'Износостойкость',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Свойство объекта, описывающее запас прочности и деградацию при каждом применении.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 180 },
    interfaceItems: [
      'current_durability: int — текущая прочность',
      'max_durability: int — предел прочности',
      'degrade(amount) — снизить прочность',
    ],
    internalLogic: [
      'При падении current_durability до 0 блокирует основной метод use()',
    ],
  },
  {
    id: 'cmp_stackable',
    type: 'component',
    title: 'Стекируемость',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Позволяет складывать одинаковые экземпляры в одну ячейку инвентаря до лимита.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 180 },
    interfaceItems: [
      'stack_count: int — количество в стеке',
      'stack_limit: int — максимум в слоте',
    ],
    internalLogic: [
      'Запрещает слияние предметов с разной прочностью',
    ],
  },
  {
    id: 'proc_pickup_item',
    type: 'process',
    title: 'Подбор предмета',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Последовательность действий при перемещении предмета из мира в инвентарь.',
    status: 'черновик',
    mvp: true,
    position: { x: 280, y: 320 },
    steps: [
      'Проверить лимит переносимого веса',
      'Если есть cmp_stackable — найти неполный стек',
      'Поместить предмет в слот и обновить вес',
    ],
    components: ['cmp_stackable'],
    uses: ['cls_item', 'cmp_durability'],
  },
  {
    id: 'cls_weapon',
    type: 'class',
    title: 'Оружие ближнего боя',
    fileName: 'sys_inventory.pgr',
    parent: 'sys_inventory',
    extendsId: 'cls_item',
    description:
      'Наследник класса Предмет со специализированным расчётом физического урона.',
    status: 'черновик',
    mvp: true,
    position: { x: 540, y: 320 },
    fields: [
      { name: 'damage', dataType: 'int', description: 'базовый урон' },
      { name: 'weight', dataType: 'int', description: 'переопределённый вес' },
    ],
    methods: [
      { visibility: '+', signature: 'attack(target)', description: 'атаковать цель' },
    ],
    components: ['cmp_durability'],
    uses: [],
  },

  // ================= FILE 2: sys_factions.pgr (3 elements) =================
  {
    id: 'sys_factions',
    type: 'system',
    title: 'Система фракций',
    fileName: 'sys_factions.pgr',
    parent: '-',
    description:
      'Правила взаимоотношений с группировками, рангов репутации и доступа к гильдиям.',
    status: 'черновик',
    mvp: false,
    position: { x: 40, y: 460 },
  },
  {
    id: 'proc_join_faction',
    type: 'process',
    title: 'Вступление во фракцию',
    fileName: 'sys_factions.pgr',
    parent: 'sys_factions',
    description:
      'Процесс проверки репутации, принесения присяги и выдачи фракционного знака.',
    status: 'черновик',
    mvp: false,
    position: { x: 280, y: 460 },
    steps: [
      'Проверить отсутствие вражды с союзными фракциями',
      'Выдать стартовый ранг через cmp_reputation_bound',
      'Передать фракционный предмет через proc_pickup_item',
    ],
    components: ['cmp_reputation_bound'],
    uses: ['sys_factions', 'proc_pickup_item'],
  },
  {
    id: 'cmp_reputation_bound',
    type: 'component',
    title: 'Привязка к репутации',
    fileName: 'sys_factions.pgr',
    parent: 'sys_factions',
    description:
      'Определяет порог отношений с фракцией для использования предмета или диалога.',
    status: 'черновик',
    mvp: false,
    position: { x: 540, y: 460 },
    interfaceItems: [
      'faction_id: string — код фракции',
      'min_rep: int — минимальный порог репутации',
    ],
    internalLogic: [
      'Блокирует доступ при падении репутации ниже min_rep',
    ],
  },

  // ================= FILE 3: idea_backlog.pgr (2 elements) =================
  {
    id: 'idea_backlog',
    type: 'idea',
    title: 'Мысль на будущее: Погодная коррозия снаряжения',
    fileName: 'idea_backlog.pgr',
    parent: '-',
    description:
      'Отдельно стоящая идея: во время дождя металлические предметы без ножен быстрее теряют прочность. В будущем может вырасти в Систему погоды.',
    status: 'черновик',
    mvp: false,
    position: { x: 40, y: 320 },
    notes: [],
  },
  {
    id: 'idea_grid_tetris',
    type: 'idea',
    title: 'Отклонённый вариант: Тетрис-сетка инвентаря WxH',
    fileName: 'idea_backlog.pgr',
    parent: '-',
    description:
      'Двумерная сетка ячеек с ручным вращением предметов при укладке.',
    status: 'черновик',
    mvp: false,
    position: { x: 40, y: 180 },
    notes: ['sys_inventory', 'cls_item'],
    altTo: 'sys_inventory',
    altReason:
      'Отказались в пользу списка с весом и стеками ради минимизации лишних действий игрока.',
  },
];

// 7 units in library matching /design/library.html ("Юнитов в библиотеке: 7")
export const INITIAL_UNIT_LIBRARY: UnitLibraryItem[] = [
  {
    unitId: 'unit_sys_inventory',
    category: '3 класса, 4 компонента',
    savedAt: 'Используется в 3 проектах',
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
    category: '2 процесса, 1 компонент',
    savedAt: 'Используется в 2 проектах',
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
    category: 'Используется в 2 проектах',
    savedAt: 'Базовый компонент',
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
    category: '1 интерфейс, 2 правила',
    savedAt: 'Используется в 4 проектах',
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
    category: '2 поля, 2 метода',
    savedAt: 'Используется в 2 проектах',
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
    category: '4 шага процесса',
    savedAt: 'Используется в 1 проекте',
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
    category: '3 шага процесса',
    savedAt: 'Используется в 2 проектах',
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
