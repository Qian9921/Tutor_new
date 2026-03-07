export type GeminiTaskType = 'code-evaluation' | 'video-evaluation' | 'health-check';

const DEFAULT_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'open-impact-lab-zob4aq';
const DEFAULT_GLOBAL_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const DEFAULT_REGIONAL_LOCATION = process.env.VERTEX_REGIONAL_LOCATION || 'us-central1';

const DEFAULT_FAST_MODEL = process.env.VERTEX_FAST_MODEL || 'gemini-3-flash-preview';
const DEFAULT_COMPLEX_MODEL = process.env.VERTEX_COMPLEX_MODEL || 'gemini-3.1-pro-preview';
const DEFAULT_FAST_FALLBACK_MODEL = process.env.VERTEX_FAST_FALLBACK_MODEL || 'gemini-2.5-flash';
const DEFAULT_COMPLEX_FALLBACK_MODEL = process.env.VERTEX_COMPLEX_FALLBACK_MODEL || 'gemini-2.5-pro';

interface TaskConfig {
  primaryModel: string;
  fallbackModel: string | null;
  primaryLocation: string;
  fallbackLocation: string | null;
}

export const GEMINI_CONFIG = {
  projectId: DEFAULT_PROJECT_ID,
  globalLocation: DEFAULT_GLOBAL_LOCATION,
  regionalLocation: DEFAULT_REGIONAL_LOCATION,
  fastModel: DEFAULT_FAST_MODEL,
  complexModel: DEFAULT_COMPLEX_MODEL,
  fastFallbackModel: DEFAULT_FAST_FALLBACK_MODEL,
  complexFallbackModel: DEFAULT_COMPLEX_FALLBACK_MODEL,
} as const;

export function getTaskConfig(taskType: GeminiTaskType): TaskConfig {
  switch (taskType) {
    case 'health-check':
      return {
        primaryModel: GEMINI_CONFIG.fastModel,
        fallbackModel: null,
        primaryLocation: GEMINI_CONFIG.globalLocation,
        fallbackLocation: null,
      };
    case 'video-evaluation':
    case 'code-evaluation':
    default:
      return {
        primaryModel: GEMINI_CONFIG.complexModel,
        fallbackModel: GEMINI_CONFIG.complexFallbackModel,
        primaryLocation: GEMINI_CONFIG.globalLocation,
        fallbackLocation: GEMINI_CONFIG.regionalLocation,
      };
  }
}
