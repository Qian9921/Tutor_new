import { GoogleAuth } from 'google-auth-library';

import { logError, logWithTime } from '@/lib/logger';
import { GEMINI_CONFIG, GeminiTaskType, getTaskConfig } from './config';

const MODULE_NAME = 'GEMINI PROVIDER';
const googleAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

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

async function getAccessToken() {
  const client = await googleAuth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

  if (!token) {
    throw new Error('无法获取 Google Cloud 访问令牌');
  }

  return token;
}

function buildEndpoint(model: string, location: string) {
  return `https://aiplatform.googleapis.com/v1/projects/${GEMINI_CONFIG.projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
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

async function invokeModel(model: string, location: string, request: Record<string, unknown>) {
  const token = await getAccessToken();
  const response = await fetch(buildEndpoint(model, location), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    cache: 'no-store',
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }

  return payload;
}

export async function generateContentWithFallback(taskType: GeminiTaskType, request: Record<string, unknown>) {
  const config = getTaskConfig(taskType);
  logWithTime(MODULE_NAME, `Using model ${config.primaryModel} in ${config.primaryLocation} for ${taskType}`);

  try {
    return await invokeModel(config.primaryModel, config.primaryLocation, request);
  } catch (error) {
    logError(MODULE_NAME, `Primary Gemini request failed for ${taskType}`, error);

    if (!config.fallbackModel || !config.fallbackLocation || !shouldRetryWithFallback(error)) {
      throw error;
    }

    logWithTime(MODULE_NAME, `Retrying ${taskType} with fallback ${config.fallbackModel} in ${config.fallbackLocation}`);
    return await invokeModel(config.fallbackModel, config.fallbackLocation, request);
  }
}

export async function generateTextWithFallback(taskType: GeminiTaskType, request: Record<string, unknown>) {
  const payload = await generateContentWithFallback(taskType, request);
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || typeof text !== 'string') {
    throw new Error(`Gemini 返回了空文本 (${taskType})`);
  }

  return text;
}
