// 플레이 퀴즈 점수: 문제별로 처음 맞혔을 때 한 번만 가산한다. 오답 뒤 재도전 정답도 인정, 중복 가산 없음.

export interface QuizScore {
  correct: ReadonlySet<string>;
  attempts: number;
}

export const emptyScore = (): QuizScore => ({ correct: new Set(), attempts: 0 });

export function recordAnswer(score: QuizScore, quizId: string, isCorrect: boolean): QuizScore {
  if (!isCorrect || score.correct.has(quizId)) return { ...score, attempts: score.attempts + 1 };
  return { correct: new Set(score.correct).add(quizId), attempts: score.attempts + 1 };
}
