import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { getRepositoryFiles, parseGitHubUrl } from './github';
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
  logWithTime(MODULE_NAME, `获取仓库文件: ${owner}/${repo}`);
  
  try {
    // 获取主要文件列表
    const rootFiles = await getRepositoryFiles(owner, repo);
    
    // 筛选需要深入获取内容的文件和目录
    const result: Array<{path: string; content: string}> = [];
    
    // 创建一个队列用于遍历目录
    const queue: Array<{path: string; type: string}> = rootFiles.map(item => ({
      path: item.path,
      type: item.type
    }));
    
    // 处理队列
    while (queue.length > 0) {
      const current = queue.shift();
      
      if (!current) continue;
      
      if (current.type === 'file') {
        // 如果是文件且应该包含
        if (shouldIncludeFile(current.path)) {
          try {
            const content = await getFileContent(owner, repo, current.path);
            result.push({
              path: current.path,
              content
            });
          } catch (error) {
            logError(MODULE_NAME, `获取文件内容失败: ${current.path}`, error);
            // 跳过这个文件，继续处理其他文件
          }
        }
      } else if (current.type === 'dir') {
        // 如果是目录且应该包含
        if (shouldIncludeDirectory(current.path)) {
          try {
            const dirFiles = await getRepositoryFiles(owner, repo, current.path);
            
            // 将目录中的文件和子目录添加到队列
            for (const item of dirFiles) {
              queue.push({
                path: item.path,
                type: item.type
              });
            }
          } catch (error) {
            logError(MODULE_NAME, `获取目录内容失败: ${current.path}`, error);
            // 跳过这个目录，继续处理其他文件和目录
          }
        }
      }
    }
    
    logWithTime(MODULE_NAME, `获取到${result.length}个文件`);
    return result;
  } catch (error) {
    logError(MODULE_NAME, '获取仓库文件失败', error);
    throw new Error(`获取仓库文件失败: ${(error as Error).message}`);
  }
}

/**
 * 获取文件内容
 */
async function getFileContent(owner: string, repo: string, path: string): Promise<string> {
  try {
    // 使用GitHub模块获取文件内容
    const result = await getRepositoryFiles(owner, repo, path);
    
    if (Array.isArray(result) && result.length === 1 && result[0].content) {
      return result[0].content;
    }
    
    throw new Error('获取文件内容失败');
  } catch (error) {
    throw new Error(`获取文件内容失败: ${(error as Error).message}`);
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
 * 判断是否应该包含该目录
 */
function shouldIncludeDirectory(path: string): boolean {
  return !EXCLUDED_DIRECTORIES.some(dir => 
    path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`)
  );
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
  
  // 转义正则表达式特殊字符
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };
  
  // 计算相关性分数
  const scoredFiles = files.map(file => {
    const relevance = calculateRelevanceScore(
      file.path,
      file.content,
      currentTask,
      safeTasks,
      safeProjectDetail,
      safeEvidence,
      escapeRegExp
    );
    
    return {
      ...file,
      relevance
    };
  });
  
  // 按相关性排序
  const sortedFiles = scoredFiles.sort((a, b) => b.relevance - a.relevance);
  
  logWithTime(MODULE_NAME, `按相关性排序后，返回 ${sortedFiles.length} 个文件`);
  sortedFiles.slice(0, 10).forEach((file, index) => {
    logWithTime(MODULE_NAME, `相关文件 ${index+1}: ${file.path} (相关性: ${file.relevance.toFixed(2)})`);
  });
  
  return sortedFiles;
}

/**
 * 计算文件与任务的相关性分数
 */
function calculateRelevanceScore(
  filePath: string,
  fileContent: string,
  currentTask: string,
  allTasks: string[],
  projectDetail: string,
  evidence: string,
  escapeRegExp: (str: string) => string
): number {
  // 将路径和内容转为小写，用于不区分大小写的匹配
  const lowerPath = filePath.toLowerCase();
  const lowerContent = fileContent.toLowerCase();
  
  // 基础分数
  let score = 0;
  
  // 辅助函数：计算关键词匹配分数
  const calculateWordMatchScore = (
    text: string, 
    pathWeight: number, 
    contentWeight: number
  ): number => {
    let matchScore = 0;
    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/).filter(word => word.length > 3);
    
    for (const word of words) {
      // 路径匹配
      if (lowerPath.includes(word)) {
        matchScore += pathWeight;
      }
      
      // 内容匹配 - 使用try-catch来处理正则表达式错误
      try {
        // 转义特殊字符
        const safeWord = escapeRegExp(word);
        const regex = new RegExp(safeWord, 'gi');
        const matches = lowerContent.match(regex);
        if (matches) {
          matchScore += contentWeight * Math.min(matches.length, 10);
        }
      } catch (error) {
        logError(MODULE_NAME, `正则表达式匹配失败, 单词: ${word}`, error);
        // 继续处理其他单词
      }
    }
    
    return matchScore;
  };
  
  // 计算各项评分
  
  // 1. 当前任务评分 - 较高权重
  score += calculateWordMatchScore(currentTask, 0.2, 0.05);
  
  // 2. 所有子任务评分 - 中等权重
  // 排除当前任务，避免重复计算
  const otherTasks = allTasks.filter(t => t !== currentTask);
  for (const subTask of otherTasks.slice(0, 5)) { // 最多处理5个其他任务
    score += calculateWordMatchScore(subTask, 0.1, 0.03);
  }
  
  // 3. 项目详情评分 - 较低权重
  score += calculateWordMatchScore(projectDetail, 0.05, 0.02);
  
  // 4. 证据评分 - 最高权重
  score += calculateWordMatchScore(evidence, 0.4, 0.1);
  
  // 根据文件类型加分 - 次要权重
  if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) {
    score += 0.1; // TypeScript文件加分
  }
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) {
    score += 0.08; // JavaScript文件加分
  }
  if (lowerPath.includes('/api/')) {
    score += 0.15; // API相关文件加分
  }
  if (lowerPath.includes('/components/')) {
    score += 0.1; // 组件文件加分
  }
  if (lowerPath.includes('/pages/') || lowerPath.includes('/app/')) {
    score += 0.1; // 页面文件加分
  }
  if (lowerPath.includes('/lib/') || lowerPath.includes('/utils/')) {
    score += 0.1; // 库和工具文件加分
  }
  
  // 规范化分数到0-1范围
  score = Math.min(Math.max(score, 0), 1);
  
  return score;
} 