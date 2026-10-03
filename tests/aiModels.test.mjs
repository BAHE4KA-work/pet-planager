import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GEMINI_MODEL, GEMINI_MODELS, normalizeGeminiModel } from '../src/data/aiModels.ts';

test('Gemini settings offer active text models and omit the retired preview', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
  assert.ok(GEMINI_MODELS.includes('gemini-3.1-flash-lite'));
  assert.ok(GEMINI_MODELS.includes('gemma-4-31b-it'));
  assert.ok(GEMINI_MODELS.includes('gemma-4-26b-a4b-it'));
  assert.ok(!GEMINI_MODELS.includes('gemini-3.1-flash-lite-preview'));
});

test('retired Gemini model settings migrate to the stable replacement', () => {
  assert.equal(normalizeGeminiModel('gemini-3.1-flash-lite-preview'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModel('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeGeminiModel('gemma-4-26b-a4b-it'), 'gemma-4-26b-a4b-it');
  assert.equal(normalizeGeminiModel('unknown-model'), DEFAULT_GEMINI_MODEL);
});
