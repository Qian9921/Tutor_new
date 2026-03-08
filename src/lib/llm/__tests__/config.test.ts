import { GEMINI_CONFIG, getTaskConfig } from '@/lib/llm/config';

describe('getTaskConfig', () => {
  test('routes health-check to fast model without fallback', () => {
    const config = getTaskConfig('health-check');

    expect(config.primaryModel).toBe(GEMINI_CONFIG.fastModel);
    expect(config.primaryLocation).toBe(GEMINI_CONFIG.globalLocation);
    expect(config.fallbackModel).toBeNull();
    expect(config.fallbackLocation).toBeNull();
  });

  test('routes code evaluation to complex model with fallback', () => {
    const config = getTaskConfig('code-evaluation');

    expect(config.primaryModel).toBe(GEMINI_CONFIG.complexModel);
    expect(config.primaryLocation).toBe(GEMINI_CONFIG.globalLocation);
    expect(config.fallbackModel).toBe(GEMINI_CONFIG.complexFallbackModel);
    expect(config.fallbackLocation).toBe(GEMINI_CONFIG.regionalLocation);
  });

  test('routes video evaluation to complex model with fallback', () => {
    const config = getTaskConfig('video-evaluation');

    expect(config.primaryModel).toBe(GEMINI_CONFIG.complexModel);
    expect(config.fallbackModel).toBe(GEMINI_CONFIG.complexFallbackModel);
  });
});
