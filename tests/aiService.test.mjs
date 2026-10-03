import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const element = (id, type, extras = {}) => ({
  id, type, title: id, fileName: 'plan.pgr', parent: type === 'system' ? '-' : 'sys_root',
  description: id, status: 'черновик', mvp: false, position: { x: 0, y: 0 }, ...extras,
});

test('public applyInterviewAnswer path validates patches against the full current graph', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'planager-ai-service-'));
  try {
    const validationPath = pathToFileURL(join(process.cwd(), 'src/utils/aiValidation.ts')).href;
    const source = await readFile(new URL('../src/services/ai.ts', import.meta.url), 'utf8');
    const testTransportPath = pathToFileURL(join(temp, 'transport.mjs')).href;
    const testEnginePath = pathToFileURL(join(temp, 'engine.mjs')).href;
    const injectedSource = source
      .replace("from './desktop'", `from '${testTransportPath}'`)
      .replace("from '../utils/aiEngine'", `from '${testEnginePath}'`)
      .replace("from '../utils/aiValidation'", `from '${validationPath}'`);
    const modulePath = join(temp, 'ai.mts');
    await writeFile(join(temp, 'transport.mjs'), 'export async function desktopInvoke() { return globalThis.__aiTestResponse; }');
    await writeFile(join(temp, 'engine.mjs'), `export function buildRagIndex(elements, files) { return elements.filter(e => files.includes(e.fileName)).map((e, i) => ({ elementId: e.id, citation: e.fileName + ':' + (i + 1) + '-' + (i + 1), snippet: e.id })); } export function inspectGraphSchemaIssues() { return []; }`);
    await writeFile(modulePath, injectedSource);
    const { applyInterviewAnswer, buildScopedAiContext } = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
    const system = element('sys_root', 'system');
    const clsA = element('cls_a', 'class', { extendsId: '-' });
    const clsB = element('cls_b', 'class', { extendsId: 'cls_a' });
    const cmp = element('cmp_a', 'component');
    const graph = [system, clsA, clsB, cmp];
    const scoped = buildScopedAiContext(graph, ['plan.pgr'], ['cls_b']);
    assert.deepEqual(scoped.payload.elements.map((item) => item.id), ['cls_b']);
    assert.deepEqual(scoped.payload.citations.map((item) => item.elementId), ['cls_b']);
    assert.equal(scoped.payload.citations[0].citation, 'plan.pgr:3-3', 'citation retains its full-project source line');
    assert.deepEqual(buildScopedAiContext(graph, ['plan.pgr'], []).payload.elements.map((item) => item.id), graph.map((item) => item.id));
    const params = { targetElement: clsA, existingElements: graph, question: 'q', answer: 'a', config: {} };
    const response = (updatedElement) => ({ data: { updatedElement, summary: 'updated' }, providerUsed: 'test', modelUsed: 'test', usage: { promptTokens: 0, completionTokens: 0 }, latencyMs: 0 });

    globalThis.__aiTestResponse = response({ extendsId: 'missing' });
    await assert.rejects(applyInterviewAnswer(params), /неверная ссылка/);
    globalThis.__aiTestResponse = response({ extendsId: 'cmp_a' });
    await assert.rejects(applyInterviewAnswer(params), /неверная ссылка/);
    globalThis.__aiTestResponse = response({ extendsId: 'cls_b' });
    await assert.rejects(applyInterviewAnswer(params), /структурно некорректный граф/);

    globalThis.__aiTestResponse = response({ extendsId: '-' });
    assert.deepEqual((await applyInterviewAnswer(params)).updatedElement, { extendsId: '-' });
  } finally {
    delete globalThis.__aiTestResponse;
    await rm(temp, { recursive: true, force: true });
  }
});
