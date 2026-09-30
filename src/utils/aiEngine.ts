import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  PlanElement,
} from '../types/planager';
import { serializeFileWithRanges } from './pgrCodec';

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

export function generateLocalAnalysis(
  elements: PlanElement[],
  selectedIds: string[],
  files: string[]
): {
  proposals: AiProposalCard[];
  contradictions: AiContradiction[];
} {
  const rag = buildRagIndex(elements, files);
  const findCitation = (id: string) =>
    rag.find((r) => r.elementId === id)?.citation || 'sys_inventory.pgr:1-20';

  const proposals: AiProposalCard[] = [];
  const contradictions: AiContradiction[] = [];

  const clsItem = elements.find((e) => e.id === 'cls_item');
  const clsWeapon = elements.find((e) => e.id === 'cls_weapon');

  // 1. Exact contradiction from /design/knowledge-base.html:
  // "⚠ Возможное противоречие с cls_weapon по полю weight"
  if (clsItem && clsWeapon) {
    const wWeapon = (clsWeapon.fields || []).find((f) => f.name === 'weight');
    if (wWeapon && wWeapon.dataType !== 'float') {
      contradictions.push({
        id: 'contra_weight_type_mismatch',
        severity: 'high',
        title: 'Возможное противоречие с cls_weapon по полю weight',
        description:
          'В базовом классе cls_item поле weight имеет тип float (вес в кг), а в наследуемом классе cls_weapon (extends: cls_item) оно переопределено как int. Это приведёт к потере дробной части веса (например, у obj_sword_excalibur weight = 3.2).',
        elementIds: ['cls_item', 'cls_weapon', 'obj_sword_excalibur'],
        fileCitation: findCitation('cls_item'),
        resolutionHint:
          'Удалить дублирующее поле weight: int из cls_weapon, чтобы оно наследовалось от cls_item как float.',
        suggestedFix: {
          targetElementId: 'cls_weapon',
          patch: {
            fields: (clsWeapon.fields || []).filter((f) => f.name !== 'weight'),
          },
          fixLabel: 'Синхронизировать поле weight (убрать конфликт в cls_weapon)',
        },
      });
    }
  }

  // 2. Contradiction between cmp_stackable and cmp_durability on cls_item
  if (
    clsItem &&
    clsItem.components?.includes('cmp_durability') &&
    clsItem.components?.includes('cmp_stackable')
  ) {
    contradictions.push({
      id: 'contra_stack_durability',
      severity: 'medium',
      title: 'Конфликт правил: cmp_stackable и cmp_durability в sys_inventory',
      description:
        'Логика cmp_stackable запрещает слияние предметов с разной прочностью, но базовый cls_item в системе sys_inventory включает оба компонента одновременно, а процесс proc_pickup_item объединяет стеки без проверки прочности.',
      elementIds: ['sys_inventory', 'cls_item', 'proc_pickup_item'],
      fileCitation: findCitation('cls_item'),
      resolutionHint:
        'Уточнить в proc_pickup_item проверку полной прочности перед объединением стека.',
      suggestedFix: {
        targetElementId: 'proc_pickup_item',
        patch: {
          steps: [
            'Проверить лимит переносимого веса',
            'Если есть cmp_stackable и current_durability == max_durability — найти неполный стек',
            'Поместить предмет в слот и обновить вес',
          ],
        },
        fixLabel: 'Добавить проверку прочности в proc_pickup_item',
      },
    });
  }

  // 1. Exact proposal from /design/knowledge-base.html:
  // "Предложение: добавить компонент cmp_rarity"
  if (!elements.some((e) => e.id === 'cmp_rarity')) {
    proposals.push({
      id: 'prop_add_cmp_rarity',
      category: 'new_element',
      title: 'Предложение: добавить компонент cmp_rarity',
      rationale:
        'Для разграничения обычных предметов (cls_item) и уникальных экземпляров вроде Экскалибура (obj_sword_excalibur) рекомендуется выделить компонент редкости cmp_rarity и подключить его к cls_item.',
      targetElementId: 'cls_item',
      fileCitation: findCitation('cls_item'),
      suggestedElement: {
        id: 'cmp_rarity',
        type: 'component',
        title: 'Редкость и ценность',
        fileName: 'sys_inventory.pgr',
        parent: 'sys_inventory',
        mvp: true,
        description:
          'Определяет ранг редкости предмета и модификатор его ценности при обмене.',
        interfaceItems: [
          'rarity_tier: string — обычное / редкое / легендарное',
          'value_mult: float — множитель базовой ценности',
        ],
        internalLogic: [
          'Запрещает разбор легендарных предметов на обычный лом',
        ],
      },
    });
  }

  proposals.push({
    id: 'prop_repair_process',
    category: 'balance',
    title: 'Предложение: добавить процесс ремонта proc_repair_item',
    rationale:
      'В sys_inventory есть компонент износа cmp_durability, но отсутствует процесс восстановления прочности.',
    targetElementId: 'sys_inventory',
    fileCitation: findCitation('cmp_durability'),
    suggestedElement: {
      id: 'proc_repair_item',
      type: 'process',
      title: 'Ремонт предмета',
      fileName: 'sys_inventory.pgr',
      parent: 'sys_inventory',
      mvp: true,
      description:
        'Восстанавливает current_durability предмета до max_durability.',
      steps: [
        'Проверить наличие cmp_durability и факт износа',
        'Списать ресурсы на починку',
        'Установить current_durability = max_durability',
      ],
      components: ['cmp_durability'],
      uses: ['cls_item', 'cmp_durability'],
    },
  });

  proposals.push({
    id: 'prop_faction_merchant_obj',
    category: 'polish',
    title: 'Предложение: добавить эталонный объект obj_faction_quartermaster',
    rationale:
      'Позволит проверить работу cmp_reputation_bound на конкретном примере интенданта фракции.',
    targetElementId: 'sys_factions',
    fileCitation: findCitation('sys_factions'),
    suggestedElement: {
      id: 'obj_faction_quartermaster',
      type: 'object',
      title: 'Интендант Северного ордена',
      fileName: 'sys_factions.pgr',
      parent: 'sys_factions',
      instanceOf: '-',
      mvp: false,
      description:
        'Экземпляр НИП на базе компонента репутации без базового класса.',
      components: ['cmp_reputation_bound'],
      values: [
        { fieldName: 'faction_id', value: '"northern_order"' },
        { fieldName: 'min_rep', value: '50' },
      ],
    },
  });

  return { proposals, contradictions };
}

export function generateLocalInterviewQuestions(
  elements: PlanElement[],
  selectedIds: string[]
): AiInterviewQuestion[] {
  const focus = elements.filter((e) => selectedIds.includes(e.id));
  const targetTitle =
    focus.length > 0 ? focus.map((f) => f.id).join(', ') : 'sys_inventory';

  return [
    {
      id: 'q_broken_item',
      targetElementId: 'cmp_durability',
      question: `Что происходит с предметом (${targetTitle}) при падении current_durability до 0?`,
      weakSpotContext:
        'В cmp_durability указана блокировка use(), но не уточнено, можно ли предмет починить или он уничтожается.',
      quickOptions: [
        'Предмет остаётся в инвентаре со статусом «сломан» до ремонта',
        'Обычные предметы разрушаются, уникальные (obj_sword_excalibur) только блокируются',
      ],
    },
    {
      id: 'q_faction_leave',
      targetElementId: 'sys_factions',
      question:
        'Может ли игрок состоять в нескольких фракциях одновременно при вызове proc_join_faction?',
      weakSpotContext:
        'В proc_join_faction проверяется отсутствие вражды, но не лимит членства.',
      quickOptions: [
        'Только одна основная фракция + малые гильдии',
        'Любое число невраждебных друг другу фракций',
      ],
    },
  ];
}

export function generateLocalTransformation(
  source: PlanElement,
  pattern: 'system_pack' | 'class_hierarchy' | 'process_chain'
): {
  summary: string;
  createdElements: PlanElement[];
} {
  const baseSlug = source.id.replace(/^(idea_|sys_|cls_|proc_|cmp_|obj_)/, '');
  const fileName = source.fileName;
  const baseX = source.position.x + 240;
  const baseY = source.position.y;

  if (pattern === 'system_pack') {
    const sysId = `sys_${baseSlug}_weather`;
    const cmpId = `cmp_${baseSlug}_corrosion`;
    const clsId = `cls_${baseSlug}_zone`;
    return {
      summary: `Элемент «${source.id}» развёрнут в Систему (${sysId}), Компонент (${cmpId}) и Класс (${clsId}) с сохранением связи с источником.`,
      createdElements: [
        {
          id: sysId,
          type: 'system',
          title: `Система: ${source.title.slice(0, 28)}`,
          fileName,
          parent: '-',
          description: `Развёрнуто из ${source.id}: ${source.description}`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX, y: baseY },
        },
        {
          id: cmpId,
          type: 'component',
          title: `Коррозия от среды`,
          fileName,
          parent: sysId,
          description: `Компонент ускоренного износа (источник: ${source.id}).`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX + 240, y: baseY },
          interfaceItems: ['corrosion_rate: float — множитель износа'],
          internalLogic: ['Увеличивает расход прочности в сырую погоду'],
        },
        {
          id: clsId,
          type: 'class',
          title: `Погодная зона`,
          fileName,
          parent: sysId,
          extendsId: '-',
          description: `Класс зоны с повышенной влажностью (источник: ${source.id}).`,
          status: 'черновик',
          mvp: source.mvp,
          originIdeaId: source.id,
          position: { x: baseX + 240, y: baseY + 140 },
          fields: [
            { name: 'humidity', dataType: 'float', description: 'влажность 0..1' },
          ],
          methods: [
            { visibility: '+', signature: 'tick_weather()', description: 'применить эффект' },
          ],
          components: [cmpId],
          uses: [],
        },
      ],
    };
  }

  const parentSys =
    source.type === 'system'
      ? source.id
      : source.parent !== '-'
      ? source.parent
      : 'sys_inventory';
  const clsId = `cls_${baseSlug}_model`;
  const objId = `obj_${baseSlug}_sample`;
  return {
    summary: `Из «${source.id}» созданы Класс (${clsId}) и Объект (${objId}).`,
    createdElements: [
      {
        id: clsId,
        type: 'class',
        title: `Класс (${source.id})`,
        fileName,
        parent: parentSys,
        extendsId: '-',
        description: source.description,
        status: 'черновик',
        mvp: true,
        originIdeaId: source.id,
        position: { x: baseX, y: baseY },
        fields: [{ name: 'power', dataType: 'float', description: 'мощность' }],
        methods: [{ visibility: '+', signature: 'apply()', description: 'применить' }],
        components: [],
        uses: [],
      },
      {
        id: objId,
        type: 'object',
        title: `Экземпляр (${source.id})`,
        fileName,
        parent: parentSys,
        instanceOf: clsId,
        description: `Конкретный пример для ${clsId}.`,
        status: 'черновик',
        mvp: true,
        originIdeaId: source.id,
        position: { x: baseX + 240, y: baseY },
        components: [],
        values: [{ fieldName: 'power', value: '10.0' }],
      },
    ],
  };
}
