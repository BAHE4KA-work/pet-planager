import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  PlanElement,
} from '../types/planager';
import { serializeFileWithRanges } from './pgrCodec';

/**
 * Builds indexed RAG chunks with exact .pgr file and line numbers (e.g. inventory.pgr:1-24)
 */
export function buildRagIndex(elements: PlanElement[], files: string[]) {
  const index: {
    elementId: string;
    title: string;
    type: string;
    fileName: string;
    startLine: number;
    endLine: number;
    citation: string;
    snippet: string;
  }[] = [];

  for (const fileName of files) {
    const { ranges } = serializeFileWithRanges(elements, fileName);
    for (const r of ranges) {
      const el = elements.find((e) => e.id === r.elementId);
      if (!el) continue;
      index.push({
        elementId: el.id,
        title: el.title,
        type: el.type,
        fileName,
        startLine: r.startLine,
        endLine: r.endLine,
        citation: `${fileName}:${r.startLine}-${r.endLine}`,
        snippet: r.rawText,
      });
    }
  }
  return index;
}

/**
 * Local deterministic architectural analyzer & fallback engine so that AI features
 * (Proposals, Proactive Contradictions, Problem Interview, Element Transformation)
 * work instantaneously and reliably in all conditions.
 */
export function generateLocalAnalysis(
  elements: PlanElement[],
  selectedIds: string[],
  files: string[]
): {
  proposals: AiProposalCard[];
  contradictions: AiContradiction[];
} {
  const rag = buildRagIndex(elements, files);
  const findCitation = (id: string) => rag.find((r) => r.elementId === id)?.citation || 'inventory.pgr:1-18';

  const focusElements =
    selectedIds.length > 0
      ? elements.filter((e) => selectedIds.includes(e.id))
      : elements;

  const proposals: AiProposalCard[] = [];
  const contradictions: AiContradiction[] = [];

  // 1. Check for balance & contradiction between Inventory (cmp_stackable + cmp_durability) on cls_item / obj_healing_flask
  const clsItem = elements.find((e) => e.id === 'cls_item');
  const objFlask = elements.find((e) => e.id === 'obj_healing_flask');
  if (clsItem && clsItem.components?.includes('cmp_durability') && clsItem.components?.includes('cmp_stackable')) {
    contradictions.push({
      id: 'contra_stack_durability',
      severity: 'high',
      title: 'Конфликт правил: Стекируемость vs Износостойкость на базовом Предмете',
      description:
        'Базовый класс «Предмет» (cls_item) одновременно включает cmp_durability и cmp_stackable, но внутренняя логика cmp_stackable запрещает объединять предметы с разной прочностью. Из-за этого зелья и ресурсы, наследующие cls_item, получают лишний параметр износа.',
      elementIds: ['cls_item', 'cmp_durability', 'cmp_stackable'],
      fileCitation: findCitation('cls_item'),
      resolutionHint:
        'Убрать cmp_durability из базового cls_item и оставить его только в наследуемом классе cls_weapon (и броне).',
      suggestedFix: {
        targetElementId: 'cls_item',
        patch: {
          components: (clsItem.components || []).filter((c) => c !== 'cmp_durability'),
        },
        fixLabel: 'Оставить в cls_item только cmp_stackable (убрать cmp_durability)',
      },
    });
  }

  // 2. Check if obj_healing_flask has charges > 1 AND stack_count > 1 conflict
  if (objFlask && objFlask.components?.includes('cmp_consumable') && objFlask.components?.includes('cmp_stackable')) {
    contradictions.push({
      id: 'contra_flask_charges_stack',
      severity: 'medium',
      title: 'Неоднозначность стека многозарядного флакона (obj_healing_flask)',
      description:
        'Объект «Флакон алой росы» имеет charges: 3 (cmp_consumable) и stack_limit: 5 (cmp_stackable). Если игрок отпил 1 глоток (charges: 2), неясно, должен ли флакон отделяться в новый слот инвентаря при proc_pickup_item.',
      elementIds: ['obj_healing_flask', 'cmp_consumable', 'proc_pickup_item'],
      fileCitation: findCitation('obj_healing_flask'),
      resolutionHint:
        'Добавить в proc_pickup_item шаг проверки полного заряда (charges == max) перед слиянием стека.',
      suggestedFix: {
        targetElementId: 'proc_pickup_item',
        patch: {
          steps: [
            'Проверить доступный лимит переносимого веса персонажа',
            'Проверить, что у предмета полные заряды (cmp_consumable) и не повреждена прочность',
            'Если у предмета есть cmp_stackable, найти неполный стек идентичного состояния',
            'Поместить остаток в новую ячейку и пересчитать нагрузку инвентаря',
          ],
        },
        fixLabel: 'Уточнить шаги proc_pickup_item для многозарядных предметов',
      },
    });
  }

  // 3. Check if any non-MVP process depends on or is isolated from MVP elements
  const tradeProc = elements.find((e) => e.id === 'proc_trade_deal');
  if (tradeProc && !tradeProc.mvp && clsItem?.mvp) {
    contradictions.push({
      id: 'contra_mvp_economy_gap',
      severity: 'medium',
      title: 'Поле base_value в MVP-классе cls_item не используется в контуре MVP',
      description:
        'У класса cls_item (метка MVP) задано поле base_value (ценность в монетах), но единственный использующий его процесс proc_trade_deal находится вне фазы MVP.',
      elementIds: ['cls_item', 'proc_trade_deal'],
      fileCitation: findCitation('proc_trade_deal'),
      resolutionHint: 'Либо включить proc_trade_deal в фазу MVP, либо отложить балансировку цен (base_value) на пост-MVP.',
      suggestedFix: {
        targetElementId: 'proc_trade_deal',
        patch: { mvp: true },
        fixLabel: 'Включить proc_trade_deal в контур MVP',
      },
    });
  }

  // Generate Proposal Cards tailored to selected context or overall plan
  const primaryFocus = focusElements[0] || elements[0];
  if (primaryFocus) {
    proposals.push({
      id: 'prop_repair_process',
      category: 'new_element',
      title: 'Добавить Процесс-функцию «Ремонт снаряжения» (proc_repair_item)',
      rationale: `В контексте ${primaryFocus.title} активно используется компонент износа cmp_durability, однако в плане отсутствует процесс восстановления прочности сломанного оружия (например, obj_rust_sword).`,
      targetElementId: 'sys_inventory',
      fileCitation: findCitation(primaryFocus.id),
      suggestedElement: {
        id: 'proc_repair_item',
        type: 'process',
        title: 'Ремонт снаряжения на верстаке',
        fileName: 'inventory.pgr',
        parent: 'sys_inventory',
        mvp: true,
        description:
          'Восстанавливает current_durability предмета до max_durability за счёт ремонтного набора или монет у кузнеца.',
        steps: [
          'Проверить наличие компонента cmp_durability и факт износа (current < max)',
          'Рассчитать стоимость ремонта пропорционально потерянной прочности и base_value',
          'Списать ремонтный ресурс из инвентаря',
          'Восстановить current_durability до max_durability и снять блокировку использования',
        ],
        components: ['cmp_durability'],
        uses: ['cls_item', 'cls_weapon', 'cmp_durability'],
      },
    });

    proposals.push({
      id: 'prop_intoxication_proc',
      category: 'balance',
      title: 'Сбалансировать токсичность эликсиров через процесс «Порог интоксикации»',
      rationale:
        'Компонент cmp_consumable начисляет toxicity_gain (например, +15.0 у Флакона алой росы), но в Системе алхимии пока не описан процесс распада токсинов и штрафов при передозировке.',
      targetElementId: 'sys_alchemy',
      fileCitation: findCitation('obj_healing_flask'),
      suggestedElement: {
        id: 'proc_toxicity_decay',
        type: 'process',
        title: 'Контроль и спад алхимической интоксикации',
        fileName: 'combat_alchemy.pgr',
        parent: 'sys_alchemy',
        mvp: true,
        description:
          'Отслеживает накопленный уровень токсичности от эликсиров и накладывает негативный эффект при превышении порога 100 ед.',
        steps: [
          'При вызове cmp_consumable.consume() прибавить toxicity_gain к шкале персонажа',
          'Если суммарная токсичность превышает 80%, снизить скорость регенерации выносливости',
          'Каждую минуту отдыха снижать уровень токсичности на 10 единиц',
        ],
        components: ['cmp_consumable'],
        uses: ['sys_alchemy', 'cmp_consumable', 'obj_healing_flask'],
      },
    });

    proposals.push({
      id: 'prop_encumbrance_cmp',
      category: 'rethink',
      title: 'Выделить перегрузку весом в отдельный Компонент «Грузоподъёмность»',
      rationale:
        'Сейчас проверка веса зашита только в первый шаг proc_pickup_item. Выделение cmp_encumbrance позволит единообразно применять правила веса и к персонажу, и к сундукам, и к вьючным животным.',
      targetElementId: 'proc_pickup_item',
      fileCitation: findCitation('proc_pickup_item'),
      suggestedElement: {
        id: 'cmp_encumbrance',
        type: 'component',
        title: 'Грузоподъёмность и перегруз',
        fileName: 'inventory.pgr',
        parent: 'sys_inventory',
        mvp: true,
        description:
          'Отвечает за учёт текущего и максимального веса носителя и наложение штрафов к скорости движения при перегрузе.',
        interfaceItems: [
          'current_weight: float — суммарный вес содержимого',
          'max_weight: float — порог без штрафов',
          'can_fit(weight): bool — проверка вместимости',
        ],
        internalLogic: [
          'При current_weight > max_weight снижает скорость перемещения на 40% и увеличивает расход выносливости',
        ],
      },
    });

    proposals.push({
      id: 'prop_merchant_object',
      category: 'polish',
      title: 'Создать эталонный Объект «Странствующий аптекарь» для проверки сделок',
      rationale:
        'Для проверки связки Системы фракций (cmp_reputation_bound) и Системы алхимии полезно иметь конкретный Объект-экземпляр с переопределёнными множителями цен.',
      targetElementId: 'sys_factions',
      fileCitation: findCitation('proc_trade_deal'),
      suggestedElement: {
        id: 'obj_guild_apothecary',
        type: 'object',
        title: 'Странствующий аптекарь Гильдии',
        fileName: 'factions_npc.pgr',
        parent: 'sys_factions',
        instanceOf: '-',
        mvp: false,
        description:
          'Конкретный экземпляр торговца, опирающийся только на Компоненты (без базового Класса, что допустимо по правилам Planager).',
        components: ['cmp_reputation_bound'],
        values: [
          { fieldName: 'faction_id', value: '"alchemists_guild"' },
          { fieldName: 'price_multiplier', value: '0.85' },
        ],
      },
    });
  }

  return { proposals, contradictions };
}

/**
 * Generates targeted Problem Interview questions to close weak spots in the selected context.
 */
export function generateLocalInterviewQuestions(
  elements: PlanElement[],
  selectedIds: string[]
): AiInterviewQuestion[] {
  const focus = elements.filter((e) => selectedIds.includes(e.id));
  const targetTitle = focus.length > 0 ? focus.map((f) => f.title).join(', ') : 'Системы инвентаря и алхимии';

  return [
    {
      id: 'q_broken_weapon_behavior',
      targetElementId: 'cmp_durability',
      question: `Что именно должно происходить с предметом (${targetTitle}), когда его прочность (current_durability) падает до 0 в разгар боя?`,
      weakSpotContext:
        'В cmp_durability указана блокировка основного метода использования, но не определено, уничтожается ли предмет навсегда или остаётся в слоте с минимальным уроном.',
      quickOptions: [
        'Предмет не исчезает, но наносит только 25% базового урона до ремонта',
        'Предмет полностью блокируется и требует ремонтного набора вне боя',
        'Обычные предметы разрушаются в лом, а редкие переходят в состояние «сломано»',
      ],
    },
    {
      id: 'q_alchemy_overdose',
      targetElementId: 'sys_alchemy',
      question:
        'Как система алхимии должна ограничивать спам лечебными флаконами (obj_healing_flask) во время схватки?',
      weakSpotContext:
        'У флакона задан параметр toxicity_gain: 15.0, но не зафиксирован верхний предел шкалы токсичности и последствия передозировки.',
      quickOptions: [
        'Шкала 0..100: выше 75 ед. начинается периодический урон здоровью',
        'Жёсткий лимит: нельзя выпить зелье, если токсичность превысит 100 ед.',
        'Токсичность снижает максимальный запас выносливости до ближайшего отдыха',
      ],
    },
    {
      id: 'q_reputation_scope',
      targetElementId: 'sys_factions',
      question:
        'Распространяется ли репутация фракции (cmp_reputation_bound) мгновенно на все регионы мира или зависит от локальных слухов?',
      weakSpotContext:
        'В proc_trade_deal используется единый price_multiplier по faction_id без учёта удалённости поселения.',
      quickOptions: [
        'Единая глобальная репутация для каждой фракции (проще для MVP)',
        'Локальная репутация города + глобальный ранг гильдии',
        'Слухи о проступках доходят до соседних городов с задержкой по времени',
      ],
    },
  ];
}

/**
 * Transforms a single PlanElement (such as an Idea 'idea_') into a System + Classes/Components/Processes
 * while preserving the explicit link (notes / originIdeaId) to the source element.
 */
export function generateLocalTransformation(
  source: PlanElement,
  pattern: 'system_pack' | 'class_hierarchy' | 'process_chain'
): {
  summary: string;
  createdElements: PlanElement[];
} {
  const baseSlug = source.id.replace(/^(idea_|sys_|cls_|proc_|cmp_|obj_)/, '');
  const fileName = source.fileName;
  const baseX = source.position.x + 360;
  const baseY = source.position.y;

  if (pattern === 'system_pack') {
    const sysId = `sys_${baseSlug}`;
    const cmpId = `cmp_${baseSlug}_exposure`;
    const clsId = `cls_${baseSlug}_zone`;
    const procId = `proc_${baseSlug}_tick`;

    return {
      summary: `Элемент «${source.title}» (${source.id}) развёрнут в полноценную Систему (${sysId}) с Компонентом, Классом и Процессом-функцией. Связь с исходным элементом сохранена.`,
      createdElements: [
        {
          id: sysId,
          type: 'system',
          title: `Система: ${source.title}`,
          fileName,
          parent: '-',
          description: `Системный контур, развёрнутый из идеи ${source.id}: ${source.description}`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX, y: baseY - 120 },
        },
        {
          id: cmpId,
          type: 'component',
          title: `Уязвимость к среде (${source.title.slice(0, 22)})`,
          fileName,
          parent: sysId,
          description: `Компонент отслеживания воздействия среды (создан на базе ${source.id}).`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX, y: baseY + 100 },
          interfaceItems: [
            'exposure_rate: float — коэффициент накопления эффекта среды',
            'protection_factor: float — степень защиты контейнера/ножен',
          ],
          internalLogic: [
            'Умножает базовый износ или порчу на (1 - protection_factor)',
          ],
        },
        {
          id: clsId,
          type: 'class',
          title: `Климатическая зона`,
          fileName,
          parent: sysId,
          extendsId: '-',
          description: `Описывает активные погодные условия локации и их влияние на предметы и персонажа.`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX + 350, y: baseY - 60 },
          fields: [
            { name: 'humidity', dataType: 'float', description: 'влажность воздуха (0.0 - 1.0)' },
            { name: 'corrosion_mult', dataType: 'float', description: 'множитель коррозии металла' },
          ],
          methods: [
            { visibility: '+', signature: 'apply_weather_tick(actor)', description: 'применить тик погоды к объектам' },
          ],
          components: [cmpId],
          uses: [procId],
        },
        {
          id: procId,
          type: 'process',
          title: `Погодное воздействие на экипировку`,
          fileName,
          parent: sysId,
          description: `Периодический процесс расчёта коррозии и порчи предметов при нахождении в неблагоприятной зоне.`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX + 350, y: baseY + 210 },
          steps: [
            'Проверить уровень влажности текущей зоны (cls_' + baseSlug + '_zone)',
            'Отобрать предметы экипировки с компонентом cmp_durability и ' + cmpId,
            'Снизить прочность незащищённых предметов с учётом protection_factor',
          ],
          components: [cmpId],
          uses: [clsId, cmpId, 'cmp_durability'],
        },
      ],
    };
  }

  if (pattern === 'class_hierarchy') {
    const parentSys = source.type === 'system' ? source.id : source.parent !== '-' ? source.parent : 'sys_inventory';
    const baseClsId = `cls_${baseSlug}_base`;
    const objId = `obj_${baseSlug}_sample`;
    return {
      summary: `Из «${source.title}» сформирована пара Класс (${baseClsId}) + эталонный Объект (${objId}) с сохранением связи с ${source.id}.`,
      createdElements: [
        {
          id: baseClsId,
          type: 'class',
          title: `Класс: ${source.title.slice(0, 28)}`,
          fileName,
          parent: parentSys,
          extendsId: '-',
          description: `Модельный класс, выделенный из ${source.id}: ${source.description}`,
          status: 'черновик',
          mvp: true,
          originIdeaId: source.id,
          position: { x: baseX, y: baseY },
          fields: [
            { name: 'title', dataType: 'string', description: 'наименование сущности' },
            { name: 'effect_power', dataType: 'float', description: 'интенсивность проявления' },
          ],
          methods: [
            { visibility: '+', signature: 'activate()', description: 'запуск основной логики класса' },
          ],
          components: ['cmp_durability'],
          uses: [],
        },
        {
          id: objId,
          type: 'object',
          title: `Экземпляр: ${source.title.slice(0, 24)}`,
          fileName,
          parent: parentSys,
          instanceOf: baseClsId,
          description: `Конкретный тестовый объект для проверки полей класса ${baseClsId}.`,
          status: 'черновик',
          mvp: true,
          originIdeaId: source.id,
          position: { x: baseX + 340, y: baseY },
          components: ['cmp_durability'],
          values: [
            { fieldName: 'title', value: `"Образец (${source.title.slice(0, 18)})"` },
            { fieldName: 'effect_power', value: '1.25' },
          ],
        },
      ],
    };
  }

  // process_chain
  const parentSys = source.type === 'system' ? source.id : source.parent !== '-' ? source.parent : 'sys_inventory';
  const procId = `proc_${baseSlug}_flow`;
  return {
    summary: `Элемент «${source.title}» преобразован в пошаговую Процесс-функцию (${procId}) с сохранением ссылки на ${source.id}.`,
    createdElements: [
      {
        id: procId,
        type: 'process',
        title: `Процесс: ${source.title.slice(0, 32)}`,
        fileName,
        parent: parentSys,
        description: `Последовательность действий, формализованная из ${source.id}: ${source.description}`,
        status: 'черновик',
        mvp: true,
        originIdeaId: source.id,
        position: { x: baseX, y: baseY },
        steps: [
          'Проверить входные условия и наличие необходимых компонентов у субъекта',
          'Выполнить основное преобразование состояния элементов',
          'Зафиксировать результат и уведомить связанные системы',
        ],
        components: [],
        uses: ['cls_item'],
      },
    ],
  };
}
