export interface RepositoryFile {
  path: string;
  content: string;
}

export interface RankedRepositoryFile extends RepositoryFile {
  relevance: number;
}

const MAX_RELEVANT_FILES = 80;
const ESSENTIAL_FILE_PATTERNS = [
  /^readme(\.|$)/i,
  /^package\.json$/i,
  /^requirements\.txt$/i,
  /^pyproject\.toml$/i,
  /^dockerfile$/i,
  /^next\.config\./i,
  /^tsconfig\.json$/i,
  /^src\/app\//i,
  /^src\/lib\//i,
  /^src\/components\//i,
  /^app\//i,
  /^pages\//i,
  /^api\//i,
];

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function calculateRelevanceScore(
  filePath: string,
  fileContent: string,
  currentTask: string,
  allTasks: string[],
  projectDetail: string,
  evidence: string,
): number {
  const lowerPath = filePath.toLowerCase();
  const lowerContent = fileContent.toLowerCase();
  let score = 0;

  const calculateWordMatchScore = (text: string, pathWeight: number, contentWeight: number) => {
    let matchScore = 0;
    const words = text.toLowerCase().split(/\s+/).filter((word) => word.length > 3);

    for (const word of words) {
      if (lowerPath.includes(word)) {
        matchScore += pathWeight;
      }

      try {
        const safeWord = escapeRegExp(word);
        const regex = new RegExp(safeWord, 'gi');
        const matches = lowerContent.match(regex);
        if (matches) {
          matchScore += contentWeight * Math.min(matches.length, 10);
        }
      } catch {
        // Ignore malformed regex edge cases for scoring purposes.
      }
    }

    return matchScore;
  };

  score += calculateWordMatchScore(currentTask, 0.2, 0.05);

  const otherTasks = allTasks.filter((task) => task !== currentTask);
  for (const task of otherTasks.slice(0, 5)) {
    score += calculateWordMatchScore(task, 0.1, 0.03);
  }

  score += calculateWordMatchScore(projectDetail, 0.05, 0.02);
  score += calculateWordMatchScore(evidence, 0.4, 0.1);

  if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) score += 0.1;
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) score += 0.08;
  if (lowerPath.includes('/api/')) score += 0.15;
  if (lowerPath.includes('/components/')) score += 0.1;
  if (lowerPath.includes('/pages/') || lowerPath.includes('/app/')) score += 0.1;
  if (lowerPath.includes('/lib/') || lowerPath.includes('/utils/')) score += 0.1;

  return Math.min(Math.max(score, 0), 1);
}

export function isEssentialRepositoryFile(path: string) {
  return ESSENTIAL_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

export function rankRelevantFiles(
  files: RepositoryFile[],
  currentTask: string,
  allTasks: string[],
  projectDetail: string,
  evidence: string,
  maxFiles: number = MAX_RELEVANT_FILES,
): RankedRepositoryFile[] {
  const scoredFiles = files.map((file) => ({
    ...file,
    relevance: calculateRelevanceScore(
      file.path,
      file.content,
      currentTask,
      allTasks,
      projectDetail,
      evidence,
    ),
  }));

  const essentialFiles = scoredFiles.filter((file) => isEssentialRepositoryFile(file.path));
  const nonEssentialFiles = scoredFiles.filter((file) => !isEssentialRepositoryFile(file.path));

  const uniqueFiles = new Map<string, RankedRepositoryFile>();

  [...essentialFiles.sort((a, b) => b.relevance - a.relevance), ...nonEssentialFiles.sort((a, b) => b.relevance - a.relevance)]
    .forEach((file) => {
      if (!uniqueFiles.has(file.path)) {
        uniqueFiles.set(file.path, file);
      }
    });

  return Array.from(uniqueFiles.values()).slice(0, maxFiles);
}
