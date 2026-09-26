import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

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

// POST /api/ai/analyze — Generate proposal cards & proactive contradiction detection
app.post('/api/ai/analyze', async (req, res) => {
  const { selectedElements, allElementsSummary, fileSnippets, mode, customGoal } = req.body || {};
  const ai = getGeminiClient();

  if (!ai) {
    return res.json({ fallback: true, reason: 'no_api_key' });
  }

  try {
    const prompt = `Ты — системный архитектор и геймдизайнер в среде моделирования Planager (.pgr).
Приложение НЕ использует программный код — только модельные элементы:
- Система (sys_): сборник правил и процессов
- Класс (cls_): общая логика объектов, Поля и Методы (+ публичные, - приватные)
- Процесс-функция (proc_): последовательность шагов взаимодействия
- Компонент (cmp_): независимое свойство/логика (Интерфейс и Внутренняя логика)
- Объект (obj_): экземпляр Класса (instance_of) и/или набора Компонентов (has) с переопределением Значений полей
- Идея-образ (idea_): семантическая заметка, может иметь notes, alt_to, alt_reason.

Режим запроса: ${mode || 'all'}
Дополнительная цель: ${customGoal || 'Проверить баланс, консистентность, найти противоречия и предложить улучшения.'}

Выделенные пользователем элементы (ПРИОРИТЕТНЫЙ КОНТЕКСТ):
${JSON.stringify(selectedElements || [], null, 2)}

Краткая сводка остальных элементов плана:
${JSON.stringify(allElementsSummary || [], null, 2)}

Индексированные фрагменты файлов (.pgr с номерами строк):
${JSON.stringify(fileSnippets || [], null, 2)}

Сформируй JSON-ответ на русском языке:
1. proposals — карточки-предложения (балансировка, новые элементы, переосмысление старых, полировка консистентности).
2. contradictions — обнаруженные потенциальные противоречия между элементами плана (например, конфликт правил двух Систем, отсутствие нужного Компонента у Класса/Объекта, нарушение иерархии или логический разрыв в Процессе).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
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
                  fileCitation: {
                    type: Type.STRING,
                    description: 'Например inventory.pgr:1-22',
                  },
                  suggestedElement: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      type: {
                        type: Type.STRING,
                        description: 'system | class | process | component | object | idea',
                      },
                      title: { type: Type.STRING },
                      parent: { type: Type.STRING },
                      description: { type: Type.STRING },
                      fileName: { type: Type.STRING },
                      mvp: { type: Type.BOOLEAN },
                    },
                    required: ['id', 'type', 'title', 'parent', 'description'],
                  },
                },
                required: ['id', 'category', 'title', 'rationale'],
              },
            },
            contradictions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  severity: { type: Type.STRING, description: 'high | medium' },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  elementIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  fileCitation: { type: Type.STRING },
                  resolutionHint: { type: Type.STRING },
                },
                required: ['id', 'severity', 'title', 'description', 'elementIds', 'resolutionHint'],
              },
            },
          },
          required: ['proposals', 'contradictions'],
        },
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ fallback: false, data: parsed });
  } catch (error: any) {
    console.warn('Gemini analyze fallback triggered:', error?.message || error);
    return res.json({ fallback: true, reason: error?.message || 'api_error' });
  }
});

// POST /api/ai/interview — Problem interview to close weak spots in the plan
app.post('/api/ai/interview', async (req, res) => {
  const { selectedElements, allElementsSummary, userAnswers } = req.body || {};
  const ai = getGeminiClient();

  if (!ai) {
    return res.json({ fallback: true, reason: 'no_api_key' });
  }

  try {
    const prompt = `Ты проводишь проблемное архитектурное интервью в Planager для выявления и закрытия слабых мест плана проекта.
Выделенный контекст:
${JSON.stringify(selectedElements || [], null, 2)}

Все элементы:
${JSON.stringify(allElementsSummary || [], null, 2)}

Предыдущие ответы пользователя:
${JSON.stringify(userAnswers || [], null, 2)}

Задай 3 точных, глубоких вопроса по архитектуре/балансу/связям выделенных элементов, предложив по 2-3 варианта быстрого ответа на каждый вопрос, чтобы пользователь мог ответить в один клик или написать свой вариант.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
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
                required: ['id', 'question', 'weakSpotContext', 'quickOptions'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ fallback: false, data: parsed });
  } catch (error: any) {
    return res.json({ fallback: true, reason: error?.message || 'api_error' });
  }
});

// POST /api/ai/transform — Transform one element (e.g., Idea) into a System + Classes/Components/Processes preserving link
app.post('/api/ai/transform', async (req, res) => {
  const { sourceElement, targetPattern } = req.body || {};
  const ai = getGeminiClient();

  if (!ai) {
    return res.json({ fallback: true, reason: 'no_api_key' });
  }

  try {
    const prompt = `Преобразуй исходный элемент плана Planager в набор структурированных элементов по шаблону "${targetPattern || 'system_pack'}" с сохранением связи с исходным элементом (${sourceElement?.id}).
Исходный элемент:
${JSON.stringify(sourceElement, null, 2)}

Верни массив новых элементов (Система, Классы, Компоненты, Процессы), где у исходной Идеи-образа или в новых элементах сохранена связь с источником.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            createdElements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  title: { type: Type.STRING },
                  parent: { type: Type.STRING },
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
                  steps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['id', 'type', 'title', 'parent', 'description'],
              },
            },
          },
          required: ['summary', 'createdElements'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ fallback: false, data: parsed });
  } catch (error: any) {
    return res.json({ fallback: true, reason: error?.message || 'api_error' });
  }
});

async function startServer() {
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
