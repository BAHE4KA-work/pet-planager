import type { AiInterviewQuestion } from '../types/planager';

export interface SavedInterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
  targetElementId?: string;
}

export function readSavedInterviewAnswers(value: unknown): SavedInterviewAnswer[] {
  if (Array.isArray(value)) {
    return value.flatMap((item): SavedInterviewAnswer[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<SavedInterviewAnswer>;
      if (
        typeof candidate.questionId !== 'string' || !candidate.questionId ||
        typeof candidate.question !== 'string' ||
        typeof candidate.answer !== 'string' || !candidate.answer.trim()
      ) return [];
      return [{
        questionId: candidate.questionId,
        question: candidate.question,
        answer: candidate.answer,
        ...(typeof candidate.targetElementId === 'string' ? { targetElementId: candidate.targetElementId } : {}),
      }];
    });
  }

  // Read the previous MVP shape so existing project metadata remains usable.
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([questionId, answer]) =>
      questionId && typeof answer === 'string' && answer.trim()
        ? [{ questionId, question: '', answer }]
        : []
    );
  }
  return [];
}

export function saveInterviewAnswer(
  value: unknown,
  question: AiInterviewQuestion,
  answer: string
): SavedInterviewAnswer[] {
  const saved = readSavedInterviewAnswers(value);
  const next: SavedInterviewAnswer = {
    questionId: question.id,
    question: question.question,
    answer,
    ...(question.targetElementId ? { targetElementId: question.targetElementId } : {}),
  };
  const index = saved.findIndex((item) => item.questionId === question.id);
  if (index < 0) return [...saved, next];
  return saved.map((item, itemIndex) => itemIndex === index ? next : item);
}

export function interviewAnswersForContext(
  value: unknown,
  selectedIds: string[]
): { question: string; answer: string; targetElementId?: string }[] {
  return readSavedInterviewAnswers(value)
    .filter((item) => !selectedIds.length || (!!item.targetElementId && selectedIds.includes(item.targetElementId)))
    .map(({ questionId, question, answer, targetElementId }) => ({
      question: question || `Previous answer (${questionId})`,
      answer,
      ...(targetElementId ? { targetElementId } : {}),
    }));
}
