import { VertexAI } from '@google-cloud/vertexai';

import { logError, logWithTime } from '@/lib/logger';
import { GEMINI_CONFIG, GeminiTaskType, getTaskConfig } from './config';

const MODULE_NAME = 'GEMINI PROVIDER';

export function extractJsonFromMarkdown(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const codeBlockMatch = text.match(codeBlockRegex);
    if (codeBlockMatch?.[1]) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch {
        // continue to broader extraction
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }

    return null;
  }
}

function createVertexClient(location: string) {
  return new VertexAI({
    project: GEMINI_CONFIG.projectId,
    location,
  });
}

function buildModel(taskType: GeminiTaskType, useFallback = false) {
  const config = getTaskConfig(taskType);
  const model = useFallback ? config.fallbackModel : config.primaryModel;
  const location = useFallback ? config.fallbackLocation : config.primaryLocation;

  if (!model || !location) {
    throw new Error(`No Gemini model configured for ${taskType} fallback=${useFallback}`);
  }

  logWithTime(MODULE_NAME, `Using model ${model} in ${location} for ${taskType}`);
  return createVertexClient(location).getGenerativeModel({ model });
}

function shouldRetryWithFallback(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'not found',
    'permission',
    'quota',
    'resource_exhausted',
    'unavailable',
    'deadline exceeded',
    '429',
    '500',
    '503',
  ].some((signal) => message.includes(signal));
}

type GeminiGenerateContentInput = Parameters<ReturnType<VertexAI['getGenerativeModel']>['generateContent']>[0];

export async function generateContentWithFallback(taskType: GeminiTaskType, request: GeminiGenerateContentInput) {
  const primaryModel = buildModel(taskType, false);

  try {
    return await primaryModel.generateContent(request);
  } catch (error) {
    logError(MODULE_NAME, `Primary Gemini request failed for ${taskType}`, error);

    const config = getTaskConfig(taskType);
    if (!config.fallbackModel || !config.fallbackLocation || !shouldRetryWithFallback(error)) {
      throw error;
    }

    const fallbackModel = buildModel(taskType, true);
    return await fallbackModel.generateContent(request);
  }
}

export async function generateTextWithFallback(taskType: GeminiTaskType, request: GeminiGenerateContentInput) {
  const response = await generateContentWithFallback(taskType, request);
  const aggregatedResponse = await response.response;
  const text = aggregatedResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!text) {
    throw new Error(`Gemini returned empty text for task ${taskType}`);
  }

  return text;
}
