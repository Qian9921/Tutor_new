interface CodeEvaluationCheckpoint {
  requirement: string;
  status: string;
  details: string;
}

interface CodeEvaluationContent {
  assessment?: number;
  checkpoints?: CodeEvaluationCheckpoint[];
  summary?: string;
  improvements?: string[];
  textContent?: string;
  message?: string;
  [key: string]: unknown;
}

export interface TeachingFeedback {
  strengths: string[];
  missingRequirements: string[];
  nextSteps: string[];
  minimumToPass: string[];
}

export interface NormalizedCodeEvaluationResult {
  rawContent: CodeEvaluationContent;
  overall: number;
  quality: number;
  functionality: number;
  maintainability: number;
  security: number;
  comments: string;
  suggestions: string[];
  teachingFeedback: TeachingFeedback;
}

function isCompletedStatus(status?: string) {
  const normalized = status?.toLowerCase() ?? '';
  return (
    (normalized.includes('complete') || normalized.includes('pass') || normalized === 'completed') &&
    !normalized.includes('not')
  );
}

function cleanSentence(text: string | undefined) {
  return (text || '').replace(/^[✅❌⚠️\s-]+/, '').trim();
}

export function normalizeAssessmentScore(assessment?: number) {
  if (typeof assessment !== 'number' || Number.isNaN(assessment)) {
    return 0;
  }

  if (assessment <= 1) {
    return Math.max(0, Math.min(10, Math.round(assessment * 10)));
  }

  return Math.max(0, Math.min(10, Math.round(assessment)));
}

export function buildTeachingFeedback(rawContent: CodeEvaluationContent): TeachingFeedback {
  const checkpoints = Array.isArray(rawContent.checkpoints) ? rawContent.checkpoints : [];
  const improvements = Array.isArray(rawContent.improvements) ? rawContent.improvements : [];

  const strengths = checkpoints
    .filter((checkpoint) => isCompletedStatus(checkpoint.status))
    .map((checkpoint) => cleanSentence(checkpoint.requirement))
    .filter(Boolean)
    .slice(0, 4);

  const missingRequirements = checkpoints
    .filter((checkpoint) => !isCompletedStatus(checkpoint.status))
    .map((checkpoint) => cleanSentence(checkpoint.requirement))
    .filter(Boolean)
    .slice(0, 5);

  const nextSteps = improvements
    .map((improvement) => cleanSentence(improvement))
    .filter(Boolean)
    .slice(0, 5);

  const minimumToPass = (missingRequirements.length > 0 ? missingRequirements : nextSteps)
    .slice(0, 3)
    .map((item) => `Focus on: ${item}`);

  return {
    strengths,
    missingRequirements,
    nextSteps,
    minimumToPass,
  };
}

export function normalizeCodeEvaluationResult(rawContent?: CodeEvaluationContent | null): NormalizedCodeEvaluationResult | null {
  if (!rawContent || typeof rawContent !== 'object') {
    return null;
  }

  const overall = normalizeAssessmentScore(rawContent.assessment);
  const commentsParts = [cleanSentence(rawContent.summary)];
  const teachingFeedback = buildTeachingFeedback(rawContent);

  if (teachingFeedback.missingRequirements.length > 0) {
    commentsParts.push(`Still missing: ${teachingFeedback.missingRequirements.join('; ')}`);
  }
  if (teachingFeedback.nextSteps.length > 0) {
    commentsParts.push(`Recommended next steps: ${teachingFeedback.nextSteps.join('; ')}`);
  }

  const comments = commentsParts.filter(Boolean).join('\n\n') || 'No detailed comments were returned by the evaluator.';
  const suggestions = teachingFeedback.nextSteps.length > 0
    ? teachingFeedback.nextSteps
    : teachingFeedback.minimumToPass.length > 0
      ? teachingFeedback.minimumToPass
      : Array.isArray(rawContent.improvements)
        ? rawContent.improvements
        : [];

  return {
    rawContent,
    overall,
    quality: overall,
    functionality: overall,
    maintainability: overall,
    security: overall,
    comments,
    suggestions,
    teachingFeedback,
  };
}
