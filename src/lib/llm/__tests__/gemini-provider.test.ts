import { extractJsonFromMarkdown } from '@/lib/llm/gemini-provider';

describe('extractJsonFromMarkdown', () => {
  test('parses direct JSON', () => {
    expect(extractJsonFromMarkdown('{"score":1}')).toEqual({ score: 1 });
  });

  test('parses fenced JSON blocks', () => {
    const input = '```json\n{"summary":"ok"}\n```';
    expect(extractJsonFromMarkdown(input)).toEqual({ summary: 'ok' });
  });

  test('extracts JSON object from surrounding text', () => {
    const input = 'Result:\n{"status":"completed","score":88}\nThanks';
    expect(extractJsonFromMarkdown(input)).toEqual({ status: 'completed', score: 88 });
  });

  test('returns null for invalid JSON payloads', () => {
    expect(extractJsonFromMarkdown('<!DOCTYPE html><html></html>')).toBeNull();
  });
});
