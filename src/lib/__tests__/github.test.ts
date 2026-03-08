import { parseGitHubUrl } from '@/lib/github';

describe('parseGitHubUrl', () => {
  test('parses standard https URL', () => {
    expect(parseGitHubUrl('https://github.com/Qian9921/OIL2_Next')).toEqual({
      owner: 'Qian9921',
      repo: 'OIL2_Next',
    });
  });

  test('parses URL with .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/Qian9921/Tutor_new.git')).toEqual({
      owner: 'Qian9921',
      repo: 'Tutor_new',
    });
  });

  test('parses SSH URL', () => {
    expect(parseGitHubUrl('git@github.com:Qian9921/Tutor_new.git')).toEqual({
      owner: 'Qian9921',
      repo: 'Tutor_new',
    });
  });

  test('throws on invalid URL', () => {
    expect(() => parseGitHubUrl('not-a-github-url')).toThrow('解析GitHub URL失败');
  });
});
