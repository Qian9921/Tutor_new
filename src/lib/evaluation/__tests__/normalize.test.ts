import { buildTeachingFeedback, normalizeAssessmentScore, normalizeCodeEvaluationResult } from '@/lib/evaluation/normalize';

describe('normalizeAssessmentScore', () => {
  test('converts 0-1 assessments to 0-10 scale', () => {
    expect(normalizeAssessmentScore(0.87)).toBe(9);
  });

  test('returns bounded score for invalid input', () => {
    expect(normalizeAssessmentScore(undefined)).toBe(0);
    expect(normalizeAssessmentScore(12)).toBe(10);
  });
});

describe('buildTeachingFeedback', () => {
  test('separates strengths and missing requirements', () => {
    const feedback = buildTeachingFeedback({
      checkpoints: [
        { requirement: 'Virtual environment created', status: '✅ Completed', details: 'Found .venv setup' },
        { requirement: 'Gemini credentials loaded from env', status: '❌ Not completed', details: 'No env loading found' },
      ],
      improvements: ['Add a clear README setup guide', 'Load Gemini credentials from environment variables'],
    });

    expect(feedback.strengths).toContain('Virtual environment created');
    expect(feedback.missingRequirements).toContain('Gemini credentials loaded from env');
    expect(feedback.nextSteps).toContain('Add a clear README setup guide');
  });
});

describe('normalizeCodeEvaluationResult', () => {
  test('creates legacy fields and teaching feedback for frontend compatibility', () => {
    const result = normalizeCodeEvaluationResult({
      assessment: 0.6,
      summary: 'Core setup is partially complete.',
      checkpoints: [
        { requirement: 'Environment setup', status: '✅ Completed', details: 'requirements.txt exists' },
        { requirement: 'Gemini API integration', status: '❌ Not completed', details: 'No API call found' },
      ],
      improvements: ['Implement Gemini client initialization', 'Document setup steps in README'],
    });

    expect(result).not.toBeNull();
    expect(result?.overall).toBe(6);
    expect(result?.quality).toBe(6);
    expect(result?.comments).toContain('Core setup is partially complete.');
    expect(result?.comments).toContain('Still missing');
    expect(result?.suggestions).toContain('Implement Gemini client initialization');
    expect(result?.teachingFeedback.missingRequirements).toContain('Gemini API integration');
  });
});
