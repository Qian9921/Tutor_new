import { calculateRelevanceScore, escapeRegExp, isEssentialRepositoryFile, rankRelevantFiles } from '@/lib/github-relevance';

describe('github-relevance helpers', () => {
  test('escapeRegExp escapes special characters', () => {
    expect(escapeRegExp('a+b*c?')).toBe('a\\+b\\*c\\?');
  });

  test('essential files are always recognized', () => {
    expect(isEssentialRepositoryFile('README.md')).toBe(true);
    expect(isEssentialRepositoryFile('src/app/page.tsx')).toBe(true);
    expect(isEssentialRepositoryFile('notes/random.txt')).toBe(false);
  });

  test('calculateRelevanceScore gives higher score to direct task matches', () => {
    const strong = calculateRelevanceScore(
      'src/app/api/gemini.ts',
      'Gemini API environment setup and Python configuration',
      'Set Up Your AI Brain',
      ['Build the UI'],
      'Create an AI assistant project',
      'Configure Gemini API and Python environment',
    );

    const weak = calculateRelevanceScore(
      'public/logo.svg',
      'decorative logo only',
      'Set Up Your AI Brain',
      ['Build the UI'],
      'Create an AI assistant project',
      'Configure Gemini API and Python environment',
    );

    expect(strong).toBeGreaterThan(weak);
  });

  test('rankRelevantFiles keeps essential files and applies caps', () => {
    const files = Array.from({ length: 100 }, (_, index) => ({
      path: index === 0 ? 'README.md' : `src/features/file-${index}.ts`,
      content: index === 0 ? 'Gemini setup guide' : `Feature file ${index}`,
    }));

    const ranked = rankRelevantFiles(
      files,
      'Set Up Your AI Brain',
      ['Build the UI'],
      'Create an AI assistant project',
      'Configure Gemini API and Python environment',
      10,
    );

    expect(ranked).toHaveLength(10);
    expect(ranked.some((file) => file.path === 'README.md')).toBe(true);
  });
});
