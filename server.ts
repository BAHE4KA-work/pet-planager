import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AiProviderConfig,
  GitCommit,
  PlanElement,
  UnitLibraryItem,
} from './src/types/planager';
import {
  INITIAL_ELEMENTS,
  INITIAL_FILES,
  INITIAL_UNIT_LIBRARY,
} from './src/data/initialProject';
import { serializeFileWithRanges } from './src/utils/pgrCodec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

const WORKSPACE_DIR = path.join(__dirname, 'workspace');
const WORKSPACE_META_PATH = path.join(WORKSPACE_DIR, 'workspace.json');

interface WorkspaceDiskState {
  files: string[];
  elements: PlanElement[];
  userPositionedNodeIds: string[];
  unitLibrary: UnitLibraryItem[];
  commits: GitCommit[];
}

function computeSnapshotHash(
  message: string,
  filesSnapshot: Record<string, string>,
  timestampIso: string
): string {
  const hash = crypto.createHash('sha1');
  hash.update(`${message}|${timestampIso}|${JSON.stringify(filesSnapshot)}`);
  return hash.digest('hex').slice(0, 7);
}

function buildFilesSnapshot(
  elements: PlanElement[],
  files: string[]
): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const f of files) {
    snap[f] = serializeFileWithRanges(elements, f).content;
  }
  return snap;
}

function writePgrFilesToDisk(elements: PlanElement[], files: string[]) {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  const snap = buildFilesSnapshot(elements, files);
  for (const [fileName, content] of Object.entries(snap)) {
    const safeName = path.basename(fileName);
    fs.writeFileSync(path.join(WORKSPACE_DIR, safeName), content, 'utf-8');
  }
  return snap;
}

function ensureWorkspaceInitialized(): WorkspaceDiskState {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }

  if (fs.existsSync(WORKSPACE_META_PATH)) {
    try {
      const raw = fs.readFileSync(WORKSPACE_META_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as WorkspaceDiskState;
      if (
        Array.isArray(parsed.files) &&
        Array.isArray(parsed.elements) &&
        parsed.elements.length > 0
      ) {
        return parsed;
      }
    } catch (e) {
      console.warn('Re-initializing workspace state after read error:', e);
    }
  }

  // Create real initial commits from actual .pgr file snapshots
  const baseElements = INITIAL_ELEMENTS.filter(
    (el) => el.fileName === 'sys_inventory.pgr' && el.id !== 'cls_weapon'
  );
  const baseFiles = ['sys_inventory.pgr'];
  const baseSnap = buildFilesSnapshot(baseElements, baseFiles);
  const t1 = new Date(Date.now() - 3600 * 1000 * 5).toISOString();

  const fullSnap = writePgrFilesToDisk(INITIAL_ELEMENTS, INITIAL_FILES);
  const t2 = new Date(Date.now() - 3600 * 1000 * 1).toISOString();

  const formatCommitTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const initialCommits: GitCommit[] = [
    {
      id: 'commit_head',
      hash: computeSnapshotHash(
        'Добавлены система фракций, идеи и класс оружия',
        fullSnap,
        t2
      ),
      message: 'Добавлены система фракций, идеи и класс оружия',
      timestamp: formatCommitTime(t2),
      author: 'Архитектор проекта',
      filesSnapshot: fullSnap,
      elementsSnapshot: JSON.parse(JSON.stringify(INITIAL_ELEMENTS)),
    },
    {
      id: 'commit_init',
      hash: computeSnapshotHash(
        'Инициализация базовой модели sys_inventory.pgr',
        baseSnap,
        t1
      ),
      message: 'Инициализация базовой модели sys_inventory.pgr',
      timestamp: formatCommitTime(t1),
      author: 'Архитектор проекта',
      filesSnapshot: baseSnap,
      elementsSnapshot: JSON.parse(JSON.stringify(baseElements)),
    },
  ];

  const initialState: WorkspaceDiskState = {
    files: INITIAL_FILES,
    elements: INITIAL_ELEMENTS,
    userPositionedNodeIds: [],
    unitLibrary: INITIAL_UNIT_LIBRARY,
    commits: initialCommits,
  };

  fs.writeFileSync(
    WORKSPACE_META_PATH,
    JSON.stringify(initialState, null, 2),
    'utf-8'
  );
  return initialState;
}

function saveWorkspaceState(state: WorkspaceDiskState) {
  writePgrFilesToDisk(state.elements, state.files);
  fs.writeFileSync(WORKSPACE_META_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveGeminiModel(config?: AiProviderConfig): string {
  const requested = config?.geminiModel;
  const allowed = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-pro-preview',
    'gemini-flash-latest',
  ];
  if (requested && allowed.includes(requested)) {
    return requested;
  }
  return 'gemini-3-flash-preview';
}

async function callStructuredAi(params: {
  prompt: string;
  systemInstruction: string;
  geminiSchema: any;
  aiConfig?: AiProviderConfig;
}): Promise<{ data: any; providerUsed: string; modelUsed: string }> {
  const { prompt, systemInstruction, geminiSchema, aiConfig } = params;
  const provider = aiConfig?.provider || 'gemini';

  if (provider === 'custom') {
    const endpoint = (aiConfig?.customEndpoint || '').trim();
    const model = (aiConfig?.customModel || 'gpt-4o-mini').trim();
    if (!endpoint) {
      throw new Error(
        'Не указан URL эндпоинта для внешнего API. Укажите URL в настройках ИИ или переключитесь на Gemini API.'
      );
    }

    const normalizedUrl = endpoint.endsWith('/chat/completions')
      ? endpoint
      : `${endpoint.replace(/\/+$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const customApiKey =
      process.env.CUSTOM_AI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (customApiKey) {
      headers['Authorization'] = `Bearer ${customApiKey}`;
    }

    const response = await fetch(normalizedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\nОтвет должен быть строго валидным JSON-объектом без markdown-обёрток.`,
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Внешний API вернул ошибку ${response.status}: ${errText.slice(0, 240)}`
      );
    }

    const json: any = await response.json();
    const rawContent =
      json?.choices?.[0]?.message?.content ||
      json?.message?.content ||
      json?.response ||
      '{}';
    const cleaned = String(rawContent)
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return {
      data: JSON.parse(cleaned),
      providerUsed: 'custom',
      modelUsed: model,
    };
  }

  // Primary provider: Google Gemini API via @google/genai
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY не найден в окружении сервера. Проверьте конфигурацию окружения.'
    );
  }

  const modelName = resolveGeminiModel(aiConfig);
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: geminiSchema,
      temperature: 0.35,
    },
  });

  const text = response.text || '{}';
  return {
    data: JSON.parse(text),
    providerUsed: 'gemini',
    modelUsed: modelName,
  };
}

// ==================== WORKSPACE PERSISTENCE ROUTES ====================

app.get('/api/workspace', (_req, res) => {
  try {
    const state = ensureWorkspaceInitialized();
    return res.json(state);
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error?.message || 'Workspace read failed' });
  }
});

app.post('/api/workspace/sync', (req, res) => {
  try {
    const current = ensureWorkspaceInitialized();
    const {
      files,
      elements,
      userPositionedNodeIds,
      unitLibrary,
      commits,
    } = req.body || {};

    const nextState: WorkspaceDiskState = {
      files: Array.isArray(files) ? files : current.files,
      elements: Array.isArray(elements) ? elements : current.elements,
      userPositionedNodeIds: Array.isArray(userPositionedNodeIds)
        ? userPositionedNodeIds
        : current.userPositionedNodeIds,
      unitLibrary: Array.isArray(unitLibrary)
        ? unitLibrary
        : current.unitLibrary,
      commits: Array.isArray(commits) ? commits : current.commits,
    };

    saveWorkspaceState(nextState);
    return res.json({ ok: true });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error?.message || 'Workspace sync failed' });
  }
});

app.post('/api/workspace/commit', (req, res) => {
  try {
    const current = ensureWorkspaceInitialized();
    const { message, author, files, elements } = req.body || {};
    const targetFiles: string[] = Array.isArray(files) ? files : current.files;
    const targetElements: PlanElement[] = Array.isArray(elements)
      ? elements
      : current.elements;

    const nowIso = new Date().toISOString();
    const formattedTime = new Date(nowIso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const filesSnapshot = writePgrFilesToDisk(targetElements, targetFiles);
    const hash = computeSnapshotHash(
      message || 'Обновление модели .pgr',
      filesSnapshot,
      nowIso
    );

    const newCommit: GitCommit = {
      id: `commit_${Date.now()}`,
      hash,
      message: (message || 'Обновление модели .pgr').trim(),
      timestamp: formattedTime,
      author: author || 'Архитектор проекта',
      filesSnapshot,
      elementsSnapshot: JSON.parse(JSON.stringify(targetElements)),
    };

    const nextState: WorkspaceDiskState = {
      ...current,
      files: targetFiles,
      elements: targetElements,
      commits: [newCommit, ...current.commits],
    };

    saveWorkspaceState(nextState);
    return res.json({ ok: true, commit: newCommit });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error?.message || 'Commit creation failed' });
  }
});

// ==================== REAL AI ROUTES (GEMINI PRIMARY + CUSTOM API) ====================

const PLANAGER_SYSTEM_INSTRUCTION = `Ты — ведущий системный архитектор в визуальной среде проектирования Planager (.pgr).
Проект строится исключительно из 6 модельных типов элементов (без программного кода):
1. system (id: sys_*) — Система: корневой контур правил, parent всегда '-'.
2. class (id: cls_*) — Класс: содержит поля (fields: name, dataType, description), методы (methods: visibility '+'|'-', signature, description), наследование extendsId, состав components (cmp_*), связи uses.
3. process (id: proc_*) — Процесс-функция: содержит упорядоченные шаги (steps: string[]), используемые элементы (uses) и компоненты (components).
4. component (id: cmp_*) — Компонент: содержит публичный интерфейс (interfaceItems: string[]) и внутренние правила (internalLogic: string[]).
5. object (id: obj_*) — Объект: экземпляр класса (instanceOf: cls_*), содержит переопределённые значения полей (values: {fieldName, value}[]) и компоненты (components).
6. idea (id: idea_*) — Идея-образ: семантическая заметка (notes: id[]), может указывать альтернативу (altTo, altReason).

Всегда возвращай осмысленные, конкретные архитектурные решения на русском языке, строго привязанные к переданным элементам .pgr и номерам строк файлов (fileCitation, например "sys_inventory.pgr:1-22").`;

// POST /api/ai/test — Check connectivity and latency of the configured AI provider
app.post('/api/ai/test', async (req, res) => {
  const { aiConfig } = req.body || {};
  const startedAt = Date.now();
  try {
    const result = await callStructuredAi({
      systemInstruction: 'Ответь кратким JSON со статусом готовности.',
      prompt: 'Проверь соединение с архитектурным ассистентом Planager.',
      aiConfig,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          message: { type: Type.STRING },
        },
        required: ['status', 'message'],
      },
    });
    return res.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      message: result.data?.message || 'Соединение активно',
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Не удалось подключиться к выбранному API',
    });
  }
});

// POST /api/ai/analyze — Generate real proposals & contradiction cards for the selected context
app.post('/api/ai/analyze', async (req, res) => {
  const {
    selectedElements,
    allElements,
    fileSnippets,
    customGoal,
    aiConfig,
  } = req.body || {};

  try {
    const prompt = `Проанализируй выделенный контекст модели Planager (.pgr) и весь граф проекта.
Дополнительная задача от пользователя: ${
      customGoal ||
      'Предложи архитектурные улучшения, новые элементы/компоненты/процессы и выяви логические или структурные противоречия.'
    }

ВЫДЕЛЕННЫЕ ЭЛЕМЕНТЫ (КОНТЕКСТ ВЫЗОВА ИИ):
${JSON.stringify(selectedElements || [], null, 2)}

ВСЕ ЭЛЕМЕНТЫ ПРОЕКТА:
${JSON.stringify(allElements || [], null, 2)}

ИНДЕКС ФАЙЛОВ .PGR С НОМЕРАМИ СТРОК:
${JSON.stringify(fileSnippets || [], null, 2)}

Требования к JSON-ответу:
1. "proposals": создай от 3 до 5 конкретных карточек предложений (категории: "balance" | "new_element" | "rethink" | "polish").
   - В каждой карточке заполни "suggestedElement" полностью (id с префиксом sys_/cls_/proc_/cmp_/obj_/idea_, type, title, parent, description, fileName, mvp, и в зависимости от типа: fields/methods для class, steps для process, interfaceItems/internalLogic для component, instanceOf/values для object).
   - В "fileCitation" указывай реальную ссылку из индекса файлов (например, "sys_inventory.pgr:12-28").
2. "contradictions": выяви реальные логические, типовые или архитектурные противоречия между элементами (например, несовпадение типов полей при наследовании, использование отсутствующих компонентов, неучтённые граничные случаи между системами).
   - Для каждого противоречия при возможности укажи "suggestedFix" с "targetElementId", "fixLabel" и объектом "patch" (например, исправленный description, steps, fields или components), чтобы пользователь мог применить исправление в один клик.`;

    const result = await callStructuredAi({
      systemInstruction: PLANAGER_SYSTEM_INSTRUCTION,
      prompt,
      aiConfig,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          proposals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                category: {
                  type: Type.STRING,
                  description: 'balance | new_element | rethink | polish',
                },
                title: { type: Type.STRING },
                rationale: { type: Type.STRING },
                targetElementId: { type: Type.STRING },
                fileCitation: { type: Type.STRING },
                suggestedElement: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    type: {
                      type: Type.STRING,
                      description:
                        'system | class | process | component | object | idea',
                    },
                    title: { type: Type.STRING },
                    parent: { type: Type.STRING },
                    description: { type: Type.STRING },
                    fileName: { type: Type.STRING },
                    mvp: { type: Type.BOOLEAN },
                    extendsId: { type: Type.STRING },
                    fields: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          dataType: { type: Type.STRING },
                          description: { type: Type.STRING },
                        },
                        required: ['name', 'dataType', 'description'],
                      },
                    },
                    methods: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          visibility: { type: Type.STRING },
                          signature: { type: Type.STRING },
                          description: { type: Type.STRING },
                        },
                        required: ['visibility', 'signature', 'description'],
                      },
                    },
                    steps: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    interfaceItems: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    internalLogic: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    components: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    uses: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['id', 'type', 'title', 'parent', 'description'],
                },
              },
              required: [
                'id',
                'category',
                'title',
                'rationale',
                'suggestedElement',
              ],
            },
          },
          contradictions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                severity: {
                  type: Type.STRING,
                  description: 'high | medium',
                },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                elementIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                fileCitation: { type: Type.STRING },
                resolutionHint: { type: Type.STRING },
                suggestedFix: {
                  type: Type.OBJECT,
                  properties: {
                    targetElementId: { type: Type.STRING },
                    fixLabel: { type: Type.STRING },
                    patch: {
                      type: Type.OBJECT,
                      properties: {
                        description: { type: Type.STRING },
                        steps: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        interfaceItems: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        internalLogic: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        components: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                      },
                    },
                  },
                  required: ['targetElementId', 'fixLabel', 'patch'],
                },
              },
              required: [
                'id',
                'severity',
                'title',
                'description',
                'elementIds',
                'resolutionHint',
              ],
            },
          },
        },
        required: ['proposals', 'contradictions'],
      },
    });

    return res.json({
      data: result.data,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
    });
  } catch (error: any) {
    console.error('AI analyze error:', error?.message || error);
    return res.status(500).json({
      error: error?.message || 'Ошибка при обращении к ИИ API',
    });
  }
});

// POST /api/ai/interview — Generate architectural interview questions for the selected elements
app.post('/api/ai/interview', async (req, res) => {
  const {
    selectedElements,
    allElements,
    fileSnippets,
    userAnswers,
    aiConfig,
  } = req.body || {};

  try {
    const prompt = `Проведи проблемное архитектурное интервью по выделенным элементам проекта Planager (.pgr), чтобы выявить узкие места, неоднозначные правила или недостающие связи.

ВЫДЕЛЕННЫЕ ЭЛЕМЕНТЫ:
${JSON.stringify(selectedElements || [], null, 2)}

ВСЕ ЭЛЕМЕНТЫ ПЛАНА:
${JSON.stringify(allElements || [], null, 2)}

ИНДЕКС ФАЙЛОВ .PGR:
${JSON.stringify(fileSnippets || [], null, 2)}

УЖЕ ДАННЫЕ ОТВЕТЫ ПОЛЬЗОВАТЕЛЯ:
${JSON.stringify(userAnswers || [], null, 2)}

Сгенерируй 3 глубоких вопроса по конкретным выделенным элементам (указывай их реальный id в targetElementId). Для каждого вопроса дай 3 содержательных варианта быстрого ответа в quickOptions.`;

    const result = await callStructuredAi({
      systemInstruction: PLANAGER_SYSTEM_INSTRUCTION,
      prompt,
      aiConfig,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                targetElementId: { type: Type.STRING },
                question: { type: Type.STRING },
                weakSpotContext: { type: Type.STRING },
                quickOptions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'id',
                'targetElementId',
                'question',
                'weakSpotContext',
                'quickOptions',
              ],
            },
          },
        },
        required: ['questions'],
      },
    });

    return res.json({
      data: result.data,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
    });
  } catch (error: any) {
    console.error('AI interview error:', error?.message || error);
    return res.status(500).json({
      error: error?.message || 'Ошибка генерации вопросов интервью ИИ',
    });
  }
});

// POST /api/ai/interview-answer — Apply an interview answer directly to the target .pgr element using AI
app.post('/api/ai/interview-answer', async (req, res) => {
  const { targetElement, question, answer, aiConfig } = req.body || {};

  try {
    const prompt = `Пользователь ответил на вопрос архитектурного интервью по элементу плана Planager (.pgr).
Обнови свойства этого элемента с учётом ответа пользователя (органично дополни description и при необходимости обнови поля fields, методы methods, шаги steps или правила interfaceItems/internalLogic в соответствии с типом элемента "${targetElement?.type}").

ЦЕЛЕВОЙ ЭЛЕМЕНТ:
${JSON.stringify(targetElement, null, 2)}

ВОПРОС ИНТЕРВЬЮ:
${question}

ОТВЕТ ПОЛЬЗОВАТЕЛЯ:
${answer}`;

    const result = await callStructuredAi({
      systemInstruction: PLANAGER_SYSTEM_INSTRUCTION,
      prompt,
      aiConfig,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          updatedElement: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    dataType: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['name', 'dataType', 'description'],
                },
              },
              methods: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    visibility: { type: Type.STRING },
                    signature: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['visibility', 'signature', 'description'],
                },
              },
              steps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              interfaceItems: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              internalLogic: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['description'],
          },
        },
        required: ['summary', 'updatedElement'],
      },
    });

    return res.json({
      data: result.data,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
    });
  } catch (error: any) {
    console.error('AI interview-answer error:', error?.message || error);
    return res.status(500).json({
      error: error?.message || 'Ошибка интеграции ответа интервью',
    });
  }
});

// POST /api/ai/transform — Transform an element into a structured subsystem / class hierarchy / process chain
app.post('/api/ai/transform', async (req, res) => {
  const { sourceElement, targetPattern, existingElements, aiConfig } =
    req.body || {};

  try {
    const patternInstruction =
      targetPattern === 'class_hierarchy'
        ? 'Создай базовый Класс (cls_*), специализированный дочерний Класс-наследник (extendsId указывает на базовый класс) и эталонный Объект (obj_*, instanceOf указывает на класс).'
        : targetPattern === 'process_chain'
        ? 'Создай последовательный Процесс (proc_*) с проработанными шагами (steps) и обеспечивающий его Компонент (cmp_*) с интерфейсом и внутренней логикой.'
        : 'Создай целостный системный пакет: новую Систему (sys_*), ключевой Класс (cls_*), Компонент (cmp_*) и Процесс (proc_*), связанные между собой (parent, components, uses).';

    const prompt = `Преобразуй (разверни) исходный элемент модели Planager (.pgr) по шаблону "${targetPattern || 'system_pack'}".
${patternInstruction}

ИСХОДНЫЙ ЭЛЕМЕНТ:
${JSON.stringify(sourceElement, null, 2)}

СУЩЕСТВУЮЩИЕ ID ЭЛЕМЕНТОВ В ПРОЕКТЕ (не дублируй их ID):
${JSON.stringify((existingElements || []).map((e: any) => ({ id: e.id, type: e.type, title: e.title })), null, 2)}

Все создаваемые элементы должны быть содержательно основаны на теме исходного элемента "${sourceElement?.title}" (${sourceElement?.description}) и иметь корректные поля/методы/шаги/интерфейсы.`;

    const result = await callStructuredAi({
      systemInstruction: PLANAGER_SYSTEM_INSTRUCTION,
      prompt,
      aiConfig,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          createdElements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: {
                  type: Type.STRING,
                  description:
                    'system | class | process | component | object | idea',
                },
                title: { type: Type.STRING },
                parent: { type: Type.STRING },
                description: { type: Type.STRING },
                mvp: { type: Type.BOOLEAN },
                extendsId: { type: Type.STRING },
                instanceOf: { type: Type.STRING },
                fields: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      dataType: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['name', 'dataType', 'description'],
                  },
                },
                methods: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      visibility: { type: Type.STRING },
                      signature: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['visibility', 'signature', 'description'],
                  },
                },
                steps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                interfaceItems: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                internalLogic: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                components: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                uses: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                values: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      fieldName: { type: Type.STRING },
                      value: { type: Type.STRING },
                    },
                    required: ['fieldName', 'value'],
                  },
                },
              },
              required: ['id', 'type', 'title', 'parent', 'description'],
            },
          },
        },
        required: ['summary', 'createdElements'],
      },
    });

    return res.json({
      data: result.data,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
    });
  } catch (error: any) {
    console.error('AI transform error:', error?.message || error);
    return res.status(500).json({
      error: error?.message || 'Ошибка ИИ-трансформации элемента',
    });
  }
});

async function startServer() {
  ensureWorkspaceInitialized();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Planager server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
