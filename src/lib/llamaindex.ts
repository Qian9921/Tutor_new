import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { rankRelevantFiles } from '@/lib/github-relevance';
import { getFileContentBySha, getRepositoryTree, parseGitHubUrl } from './github';
import { logWithTime, logError } from './logger';

// 模块名称常量
const MODULE_NAME = 'LLAMAINDEX';

// 模拟LlamaIndex处理结果
interface ProcessResult {
  repoSummary: string;
  relevantFiles: Array<{path: string; content: string; relevance: number}>;
}

// 排除的文件扩展名和目录
const EXCLUDED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.rar',
  '.mp3', '.mp4', '.avi', '.mov',
  '.ttf', '.woff', '.woff2',
  '.lock', '.map', '.json', '.yaml', '.mjs', '.gitignore'
];

const EXCLUDED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.github',
  '.vscode',
  'vendor'
];

/**
 * 处理GitHub仓库
 */
export async function processGitHubRepository(
  githubRepoUrl: string,
  projectDetail: string,
  tasks: string[],
  currentTask: string,
  evidence: string
): Promise<ProcessResult> {
  logWithTime(MODULE_NAME, '开始处理GitHub仓库');
  logWithTime(MODULE_NAME, `仓库URL: ${githubRepoUrl}`);
  logWithTime(MODULE_NAME, `当前任务: ${currentTask}`);
  
  try {
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 解析GitHub URL
    const { owner, repo } = parseGitHubUrl(githubRepoUrl);
    logWithTime(MODULE_NAME, `解析完成: ${owner}/${repo}`);
    
    // 获取仓库文件
    const files = await getRepoFiles(owner, repo);
    
    // 生成仓库摘要
    const repoSummary = createRepoSummary(owner, repo);
    
    // 保存到数据库
    const cacheId = `${owner}-${repo}`;
    const cacheRef = db.collection(COLLECTIONS.GITHUB_REPOS).doc(cacheId);
    await cacheRef.set({
      owner,
      repo,
      summary: repoSummary,
      files,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    logWithTime(MODULE_NAME, '仓库数据已保存到数据库');
    
    // 生成与当前任务相关的文件列表
    const relevantFiles = getRelevantFilesForTask(
      files,
      currentTask,
      tasks,
      projectDetail,
      evidence
    );
    
    return {
      repoSummary,
      relevantFiles
    };
  } catch (error) {
    logError(MODULE_NAME, '处理GitHub仓库失败', error);
    throw new Error(`处理GitHub仓库失败: ${(error as Error).message}`);
  }
}

/**
 * 获取仓库文件
 */
async function getRepoFiles(owner: string, repo: string): Promise<Array<{path: string; content: string}>> {
  logWithTime(MODULE_NAME, `通过仓库树获取仓库文件: ${owner}/${repo}`);

  try {
    const repositoryTree = await getRepositoryTree(owner, repo);
    const candidateFiles = repositoryTree.filter(item => item.type === 'blob' && shouldIncludeFile(item.path));

    logWithTime(MODULE_NAME, `仓库树候选文件数: ${candidateFiles.length}`);

    const concurrency = 8;
    const results: Array<{path: string; content: string}> = [];

    for (let index = 0; index < candidateFiles.length; index += concurrency) {
      const chunk = candidateFiles.slice(index, index + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const content = await getFileContentBySha(owner, repo, file.path, file.sha);
            return { path: file.path, content };
          } catch (error) {
            logError(MODULE_NAME, `获取文件内容失败: ${file.path}`, error);
            return null;
          }
        })
      );

      results.push(...chunkResults.filter((item): item is {path: string; content: string} => item !== null));
    }

    logWithTime(MODULE_NAME, `获取到${results.length}个文件`);
    return results;
  } catch (error) {
    logError(MODULE_NAME, '获取仓库文件失败', error);
    throw new Error(`获取仓库文件失败: ${(error as Error).message}`);
  }
}

/**
 * 判断是否应该包含该文件
 */
function shouldIncludeFile(path: string): boolean {
  // 检查文件扩展名
  const hasExcludedExtension = EXCLUDED_EXTENSIONS.some(ext => 
    path.toLowerCase().endsWith(ext)
  );
  
  // 检查是否在排除目录中
  const isInExcludedDir = EXCLUDED_DIRECTORIES.some(dir => 
    path.includes(`/${dir}/`) || path.startsWith(`${dir}/`)
  );
  
  return !hasExcludedExtension && !isInExcludedDir;
}

/**
 * 创建仓库摘要
 */
function createRepoSummary(owner: string, repo: string): string {
  return `GitHub仓库：${owner}/${repo}

由于没有自动摘要生成功能，这里只提供基本仓库信息，不包含具体代码分析。`;
}

/**
 * 根据当前任务获取相关文件
 */
function getRelevantFilesForTask(
  files: Array<{ path: string; content: string; }>, 
  currentTask: string, 
  tasks: string[], 
  projectDetail: string, 
  evidence: string
): Array<{path: string; content: string; relevance: number}> {
  logWithTime(MODULE_NAME, '根据任务筛选相关文件');
  logWithTime(MODULE_NAME, `任务: ${currentTask}`);
  
  // 安全地获取字符串子串，处理非字符串输入
  const safeSubstring = (text: unknown, start: number, end: number): string => {
    if (typeof text !== 'string') {
      return String(text || '').substring(start, end);
    }
    return text.substring(start, end);
  };
  
  // 确保数据类型正确
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeEvidence = typeof evidence === 'string' ? evidence : String(evidence || '');
  const safeProjectDetail = typeof projectDetail === 'string' ? projectDetail : String(projectDetail || '');
  
  // 安全地记录信息
  logWithTime(MODULE_NAME, `证据: ${safeSubstring(safeEvidence, 0, 100)}...`);
  logWithTime(MODULE_NAME, `项目详情: ${safeSubstring(safeProjectDetail, 0, 100)}...`);
  logWithTime(MODULE_NAME, `子任务数量: ${safeTasks.length}`);
  
  const sortedFiles = rankRelevantFiles(
    files,
    currentTask,
    safeTasks,
    safeProjectDetail,
    safeEvidence,
  );
  
  logWithTime(MODULE_NAME, `按相关性排序后，返回 ${sortedFiles.length} 个文件`);
  sortedFiles.slice(0, 10).forEach((file, index) => {
    logWithTime(MODULE_NAME, `相关文件 ${index+1}: ${file.path} (相关性: ${file.relevance.toFixed(2)})`);
  });
  
  return sortedFiles;
}

