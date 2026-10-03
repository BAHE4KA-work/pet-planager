import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewAnswersForContext, readSavedInterviewAnswers, saveInterviewAnswer } from '../src/utils/interviewAnswers.ts';

const first = { id: 'q1', question: 'What does this system protect?', quickOptions: ['Data', 'Access'], targetElementId: 'sys_core' };
const second = { id: 'q2', question: 'What does this process do?', quickOptions: [], targetElementId: 'proc_sync' };

test('saves interview question and answer together and updates the same question without duplicates', () => {
  const saved = saveInterviewAnswer(saveInterviewAnswer([], first, 'Private data'), first, 'Customer records');
  assert.deepEqual(saved, [{ questionId: 'q1', question: first.question, answer: 'Customer records', targetElementId: 'sys_core' }]);
});

test('restores the old answer-map metadata shape without discarding its text', () => {
  assert.deepEqual(readSavedInterviewAnswers({ old_question: 'A prior response' }), [
    { questionId: 'old_question', question: '', answer: 'A prior response' },
  ]);
});

test('sends only prior answers relevant to the selected AI context', () => {
  const saved = saveInterviewAnswer(saveInterviewAnswer([], first, 'Private data'), second, 'Retries twice');
  assert.deepEqual(interviewAnswersForContext(saved, ['sys_core']), [
    { question: first.question, answer: 'Private data', targetElementId: 'sys_core' },
  ]);
  assert.equal(interviewAnswersForContext(saved, []).length, 2);
});
