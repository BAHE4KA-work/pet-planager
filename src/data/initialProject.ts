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
  }
> = {
  emerald: {
    labelRu: 'Изумрудный (по умолч.)',
    labelEn: 'Emerald (Default)',
    main: '#15803D',
    hover: '#166534',
    soft: 'rgba(21, 128, 61, 0.12)',
    border: 'rgba(21, 128, 61, 0.35)',
    text: '#16A34A',
  },
  violet: {
    labelRu: 'Фиолетовый (Аметист)',
    labelEn: 'Violet (Amethyst)',
    main: '#6D28D9',
    hover: '#5B21B6',
    soft: 'rgba(109, 40, 217, 0.12)',
    border: 'rgba(109, 40, 217, 0.35)',
    text: '#8B5CF6',
  },
  sapphire: {
    labelRu: 'Сапфировый (Синий)',
    labelEn: 'Sapphire (Blue)',
    main: '#1D4ED8',
    hover: '#1E40AF',
    soft: 'rgba(29, 78, 216, 0.12)',
    border: 'rgba(29, 78, 216, 0.35)',
    text: '#3B82F6',
  },
  teal: {
    labelRu: 'Бирюзовый (Циан)',
    labelEn: 'Teal (Cyan)',
    main: '#0F766E',
    hover: '#115E59',
    soft: 'rgba(15, 118, 110, 0.12)',
    border: 'rgba(15, 118, 110, 0.35)',
    text: '#14B8A6',
  },
  amber: {
    labelRu: 'Янтарный (Золотой)',
    labelEn: 'Amber (Gold)',
    main: '#B45309',
    hover: '#92400E',
    soft: 'rgba(180, 83, 9, 0.12)',
    border: 'rgba(180, 83, 9, 0.35)',
    text: '#F59E0B',
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
  }
> = {
  crimson: {
    labelRu: 'Алый (по умолч.)',
    labelEn: 'Crimson (Default)',
    main: '#B91C1C',
    hover: '#991B1B',
    soft: 'rgba(185, 28, 28, 0.12)',
    border: 'rgba(185, 28, 28, 0.35)',
    text: '#EF4444',
  },
  rose: {
    labelRu: 'Розовый (Кармин)',
    labelEn: 'Rose (Carmine)',
    main: '#BE123C',
    hover: '#9F1239',
    soft: 'rgba(190, 18, 60, 0.12)',
    border: 'rgba(190, 18, 60, 0.35)',
    text: '#F43F5E',
  },
  ochre: {
    labelRu: 'Охра (Терракотовый)',
    labelEn: 'Ochre (Terracotta)',
    main: '#C2410C',
    hover: '#9A3412',
    soft: 'rgba(194, 65, 12, 0.12)',
    border: 'rgba(194, 65, 12, 0.35)',
    text: '#F97316',
  },
  slate: {
    labelRu: 'Графитовый (Нейтральный)',
    labelEn: 'Slate (Graphite)',
    main: '#475569',
    hover: '#334155',
    soft: 'rgba(71, 85, 105, 0.14)',
    border: 'rgba(71, 85, 105, 0.38)',
    text: '#94A3B8',
  },
  indigo: {
    labelRu: 'Индиго (Холодный)',
    labelEn: 'Indigo (Cold)',
    main: '#4338CA',
    hover: '#3730A3',
    soft: 'rgba(67, 56, 202, 0.12)',
    border: 'rgba(67, 56, 202, 0.35)',
    text: '#6366F1',
  },
};

export const INITIAL_ELEMENTS: PlanElement[] = [
  // ================= FILE 1: inventory.pgr =================
  {
    id: 'sys_inventory',
    type: 'system',
    title: 'Система инвентаря',
    fileName: 'inventory.pgr',
    parent: '-',
    description:
      'Управляет хранением, весом, износом и перемещением предметов между миром, экипировкой персонажа и контейнерами.',
    status: 'черновик',
    mvp: true,
    position: { x: 80, y: 70 },
  },
  {
    id: 'cmp_durability',
    type: 'component',
    title: 'Износостойкость',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Наделяет предмет или объект запасом прочности, снижающимся при использовании и влияющим на эффективность.',
    status: 'черновик',
    mvp: true,
    position: { x: 80, y: 270 },
    interfaceItems: [
      'current_durability: int — текущая прочность',
      'max_durability: int — предел прочности',
      'degrade(amount) — снизить прочность при действии',
    ],
    internalLogic: [
      'При падении current_durability до 0 блокирует основной метод использования',
      'Генерирует событие поломки для UI и звука',
    ],
  },
  {
    id: 'cmp_stackable',
    type: 'component',
    title: 'Стекируемость',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Позволяет объединять однотипные экземпляры в одну ячейку инвентаря до заданного лимита.',
    status: 'черновик',
    mvp: true,
    position: { x: 80, y: 490 },
    interfaceItems: [
      'stack_count: int — количество в пачке',
      'stack_limit: int — максимум в одной ячейке',
      'merge(other_stack) — объединение двух пачек',
    ],
    internalLogic: [
      'Запрещает объединение предметов с разной прочностью или уникальными модификаторами',
    ],
  },
  {
    id: 'cls_item',
    type: 'class',
    title: 'Предмет',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    extendsId: '-',
    description:
      'Базовый объект инвентаря: любая вещь, которую можно подобрать, использовать или сложить в стек.',
    status: 'черновик',
    mvp: true,
    position: { x: 430, y: 120 },
    fields: [
      { name: 'name', dataType: 'string', description: 'отображаемое имя' },
      { name: 'weight', dataType: 'float', description: 'вес в кг' },
      { name: 'base_value', dataType: 'int', description: 'базовая ценность в монетах' },
    ],
    methods: [
      { visibility: '+', signature: 'use()', description: 'публичный, применить предмет' },
      { visibility: '-', signature: 'validate()', description: 'приватный, проверка целостности' },
    ],
    components: ['cmp_durability', 'cmp_stackable'],
    uses: ['proc_pickup_item'],
  },
  {
    id: 'cls_weapon',
    type: 'class',
    title: 'Оружие',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    extendsId: 'cls_item',
    description:
      'Специализированный класс предметов экипировки, наносящий урон и расходующий прочность при каждой атаке.',
    status: 'черновик',
    mvp: true,
    position: { x: 430, y: 410 },
    fields: [
      { name: 'damage', dataType: 'int', description: 'базовый физический урон' },
      { name: 'stamina_cost', dataType: 'float', description: 'затраты выносливости на взмах' },
    ],
    methods: [
      { visibility: '+', signature: 'strike(target)', description: 'нанести удар по цели' },
      { visibility: '-', signature: 'calc_wear()', description: 'расчёт потери прочности от брони цели' },
    ],
    components: ['cmp_durability'],
    uses: [],
  },
  {
    id: 'proc_pickup_item',
    type: 'process',
    title: 'Подбор предмета в инвентарь',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    description:
      'Последовательность проверки веса, поиска свободного слота или слияния со существующим стеком при подборе предмета.',
    status: 'черновик',
    mvp: true,
    position: { x: 790, y: 120 },
    steps: [
      'Проверить доступный лимит переносимого веса персонажа',
      'Если у предмета есть cmp_stackable, найти неполный стек того же типа',
      'Поместить остаток в новую ячейку или выбросить излишек обратно в мир',
      'Пересчитать суммарную нагрузку инвентаря',
    ],
    components: ['cmp_stackable'],
    uses: ['cls_item', 'cmp_stackable'],
  },
  {
    id: 'obj_rust_sword',
    type: 'object',
    title: 'Ржавый клинок стражника',
    fileName: 'inventory.pgr',
    parent: 'sys_inventory',
    instanceOf: 'cls_weapon',
    description:
      'Конкретный стартовый экземпляр оружия для проверки баланса ранней фазы игры и быстрого износа.',
    status: 'черновик',
    mvp: true,
    position: { x: 790, y: 410 },
    components: ['cmp_durability'],
    values: [
      { fieldName: 'name', value: '"Ржавый клинок стражника"' },
      { fieldName: 'weight', value: '2.4' },
      { fieldName: 'base_value', value: '15' },
      { fieldName: 'damage', value: '11' },
      { fieldName: 'stamina_cost', value: '8.5' },
      { fieldName: 'current_durability', value: '18' },
      { fieldName: 'max_durability', value: '45' },
    ],
  },

  // ================= FILE 2: combat_alchemy.pgr =================
  {
    id: 'sys_alchemy',
    type: 'system',
    title: 'Система алхимии и эликсиров',
    fileName: 'combat_alchemy.pgr',
    parent: '-',
    description:
      'Отвечает за смешивание ингредиентов, интоксикацию персонажа и временные эффекты восстановления или усиления.',
    status: 'черновик',
    mvp: false,
    position: { x: 1150, y: 70 },
  },
  {
    id: 'cmp_consumable',
    type: 'component',
    title: 'Расходуемый заряд',
    fileName: 'combat_alchemy.pgr',
    parent: 'sys_alchemy',
    description:
      'Компонент одноразового или многоразового поглощения с наложением эффекта и повышением токсичности.',
    status: 'черновик',
    mvp: false,
    position: { x: 1150, y: 280 },
    interfaceItems: [
      'charges: int — число глотков/зарядов',
      'toxicity_gain: float — прирост интоксикации',
      'consume(actor) — поглотить один заряд',
    ],
    internalLogic: [
      'Уменьшает charges на 1; при достижении 0 оставляет пустой флакон или удаляет объект',
    ],
  },
  {
    id: 'obj_healing_flask',
    type: 'object',
    title: 'Флакон алой росы',
    fileName: 'combat_alchemy.pgr',
    parent: 'sys_alchemy',
    instanceOf: 'cls_item',
    description:
      'Эталонный алхимический объект, сочетающий базовый класс Предмета и компонент Расходуемого заряда.',
    status: 'черновик',
    mvp: true,
    position: { x: 1150, y: 500 },
    components: ['cmp_consumable', 'cmp_stackable'],
    values: [
      { fieldName: 'name', value: '"Флакон алой росы"' },
      { fieldName: 'weight', value: '0.35' },
      { fieldName: 'base_value', value: '60' },
      { fieldName: 'charges', value: '3' },
      { fieldName: 'toxicity_gain', value: '15.0' },
      { fieldName: 'stack_count', value: '1' },
      { fieldName: 'stack_limit', value: '5' },
    ],
  },

  // ================= FILE 3: factions_npc.pgr =================
  {
    id: 'sys_factions',
    type: 'system',
    title: 'Система фракций и репутации',
    fileName: 'factions_npc.pgr',
    parent: '-',
    description:
      'Моделирует отношение группировок к игроку, ценовые модификаторы у торговцев и реакцию стражи на действия.',
    status: 'черновик',
    mvp: false,
    position: { x: 80, y: 740 },
  },
  {
    id: 'cmp_reputation_bound',
    type: 'component',
    title: 'Зависимость от репутации',
    fileName: 'factions_npc.pgr',
    parent: 'sys_factions',
    description:
      'Модифицирует цены и доступность диалогов в зависимости от ранга отношений с фракцией.',
    status: 'черновик',
    mvp: false,
    position: { x: 430, y: 740 },
    interfaceItems: [
      'faction_id: string — идентификатор фракции',
      'price_multiplier: float — коэффициент наценки/скидки',
    ],
    internalLogic: [
      'При враждебном пороге блокирует торговлю и вызывает стражу',
    ],
  },
  {
    id: 'proc_trade_deal',
    type: 'process',
    title: 'Сделка купли-продажи с НИП',
    fileName: 'factions_npc.pgr',
    parent: 'sys_factions',
    description:
      'Процесс обмена предметов между инвентарём игрока и лавкой торговца с учётом износа и репутации.',
    status: 'черновик',
    mvp: false,
    position: { x: 790, y: 740 },
    steps: [
      'Определить базовую стоимость предмета (cls_item.base_value)',
      'Применить поправку на текущую прочность (cmp_durability)',
      'Применить фракционный множитель (cmp_reputation_bound)',
      'Передать предмет через proc_pickup_item и списать монеты',
    ],
    components: ['cmp_reputation_bound'],
    uses: ['cls_item', 'cmp_durability', 'cmp_reputation_bound', 'proc_pickup_item'],
  },

  // ================= FILE 4: ideas_backlog.pgr =================
  {
    id: 'idea_grid_tetris',
    type: 'idea',
    title: 'Сетка инвентаря в духе тетриса (Diablo-стиль)',
    fileName: 'ideas_backlog.pgr',
    parent: '-',
    description:
      'Рассматривался вариант двумерной сетки, где каждый предмет занимает WxH клеточек, а игрок вручную вращает их.',
    status: 'черновик',
    mvp: false,
    position: { x: 1150, y: 740 },
    notes: ['sys_inventory', 'cls_item'],
    altTo: 'sys_inventory',
    altReason:
      'Отказались в пользу чистого весового лимита и списка со стеками: тетрис-сетка перегружает UX на геймпаде и замедляет темп.',
  },
  {
    id: 'idea_weather_rust',
    type: 'idea',
    title: 'Влияние сырой погоды на коррозию оружия и трав',
    fileName: 'ideas_backlog.pgr',
    parent: '-',
    description:
      'Мысль на будущее: во время дождя или в болотах незащищённое металлическое оружие теряет прочность быстрее, а алхимические травы быстрее портятся без герметичной сумки. Позже можно развернуть в отдельную Систему погоды и климата.',
    status: 'черновик',
    mvp: false,
    position: { x: 1480, y: 380 },
    notes: ['cmp_durability', 'sys_alchemy'],
  },
];

export const INITIAL_UNIT_LIBRARY: UnitLibraryItem[] = [
  {
    unitId: 'unit_cmp_cooldown',
    category: 'Компоненты механик',
    savedAt: '2026-09-25',
    element: {
      id: 'cmp_cooldown',
      type: 'component',
      title: 'Перезарядка (Кулдаун)',
      parent: '-',
      description: 'Универсальный компонент ограничения частоты использования способности, предмета или процесса.',
      status: 'черновик',
      mvp: true,
      interfaceItems: [
        'cooldown_sec: float — длительность перезарядки в секундах',
        'is_ready: bool — готовность к активации',
        'trigger_cooldown() — запустить таймер',
      ],
      internalLogic: [
        'Блокирует повторный вызов до истечения таймера',
        'Синхронизируется с глобальным тиком времени или ходом',
      ],
    },
  },
  {
    unitId: 'unit_sys_telemetry_quest',
    category: 'Системы геймдизайна',
    savedAt: '2026-09-24',
    element: {
      id: 'sys_quest_journal',
      type: 'system',
      title: 'Система нелинейных квестов и слухов',
      parent: '-',
      description: 'Хранит граф состояний заданий, улик и слухов, которые игрок открывает через диалоги или осмотр мира.',
      status: 'черновик',
      mvp: true,
    },
  },
  {
    unitId: 'unit_cls_container',
    category: 'Классы мира',
    savedAt: '2026-09-24',
    element: {
      id: 'cls_loot_container',
      type: 'class',
      title: 'Контейнер (Сундук / Тайник)',
      parent: 'sys_inventory',
      extendsId: '-',
      description: 'Мировой интерактивный объект, хранящий набор предметов и опционально запертый на замок.',
      status: 'черновик',
      mvp: true,
      fields: [
        { name: 'capacity_kg', dataType: 'float', description: 'вместимость по весу' },
        { name: 'lock_level', dataType: 'int', description: 'сложность замка (0 — открыт)' },
      ],
      methods: [
        { visibility: '+', signature: 'open(actor)', description: 'попытка открыть контейнер' },
        { visibility: '-', signature: 'roll_loot()', description: 'генерация содержимого при первом открытии' },
      ],
      components: ['cmp_durability'],
      uses: ['proc_pickup_item'],
    },
  },
  {
    unitId: 'unit_proc_craft',
    category: 'Процессы',
    savedAt: '2026-09-23',
    element: {
      id: 'proc_recipe_craft',
      type: 'process',
      title: 'Крафт предмета по схеме',
      parent: 'sys_inventory',
      description: 'Пошаговый процесс проверки ресурсов, списания материалов и создания нового экземпляра предмета.',
      status: 'черновик',
      mvp: false,
      steps: [
        'Проверить наличие всех требуемых компонентов рецепта в инвентаре',
        'Списать расходуемые материалы из стеков (cmp_stackable)',
        'Создать новый экземпляр целевого Класса с начальной прочностью',
        'Поместить результат в инвентарь через proc_pickup_item',
      ],
      components: ['cmp_stackable'],
      uses: ['cls_item', 'proc_pickup_item'],
    },
  },
];

export const I18N_DICTIONARY = {
  ru: {
    navCanvas: 'Холст',
    navKnowledgeBase: 'База знаний',
    navUnitLibrary: 'Библиотека',
    navGit: 'Git-версии',
    navAi: 'ИИ-анализ',
    newElement: '+ Элемент',
    newFile: '+ Файл .pgr',
    searchPlaceholder: 'Поиск по ID, названию, полям...',
    filterAll: 'Все',
    filterMvpOnly: 'Только MVP',
    filterPostMvp: 'Потом (вне MVP)',
    emptyProjectTitle: 'В проекте пока нет файлов плана (.pgr)',
    emptyProjectSubtitle:
      'Planager хранит архитектуру проекта в человекочитаемых файлах .pgr. Создайте первый файл, разверните демо-проект или добавьте готовые блоки из Библиотеки юнитов.',
    createFirstFile: 'Создать первый файл .pgr',
    loadDemoProject: 'Загрузить пример проекта',
    openUnitLibrary: 'Открыть библиотеку юнитов',
    statusDraft: 'черновик',
    confirmYes: 'Да, подтвердить',
    confirmNo: 'Нет, отмена',
  },
  en: {
    navCanvas: 'Canvas',
    navKnowledgeBase: 'Knowledge Base',
    navUnitLibrary: 'Unit Library',
    navGit: 'Git Versions',
    navAi: 'AI Analysis',
    newElement: '+ Element',
    newFile: '+ .pgr File',
    searchPlaceholder: 'Search by ID, title, fields...',
    filterAll: 'All',
    filterMvpOnly: 'MVP Only',
    filterPostMvp: 'Later (Post-MVP)',
    emptyProjectTitle: 'This project has no plan files (.pgr) yet',
    emptyProjectSubtitle:
      'Planager stores project architecture in human-readable .pgr files. Create your first file, load the sample RPG architecture, or insert blocks from the Unit Library.',
    createFirstFile: 'Create first .pgr file',
    loadDemoProject: 'Load sample project',
    openUnitLibrary: 'Open Unit Library',
    statusDraft: 'draft',
    confirmYes: 'Yes, confirm',
    confirmNo: 'No, cancel',
  },
};
