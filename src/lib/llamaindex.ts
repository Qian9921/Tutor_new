import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { getRepositoryFiles, parseGitHubUrl, getRepoLatestUpdateTime, clearRepoCache } from './github';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [LLAMAINDEX] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [LLAMAINDEX] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [LLAMAINDEX ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 模拟LlamaIndex处理结果
interface ProcessResult {
  repoSummary: string;
  relevantFiles: Array<{path: string; content: string; relevance: number}>;
}

// 定义缓存数据类型
interface CacheData {
  owner?: string;
  repo?: string;
  summary?: string;
  files?: Array<{path: string; content: string}>;
  createdAt?: Date | {toDate(): Date} | string;
  updatedAt?: Date | {toDate(): Date} | string;
  [key: string]: unknown;
}

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
  logWithTime('开始处理GitHub仓库');
  logWithTime(`仓库URL: ${githubRepoUrl}`);
  logWithTime(`当前任务: ${currentTask}`);
  
  try {
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 解析GitHub URL
    const { owner, repo } = parseGitHubUrl(githubRepoUrl);
    logWithTime(`解析完成: ${owner}/${repo}`);
    
    // 检查缓存中是否有该仓库
    const cacheId = `${owner}-${repo}`;
    const cacheRef = db.collection(COLLECTIONS.GITHUB_REPOS).doc(cacheId);
    const cacheDoc = await cacheRef.get();
    
    // 如果有缓存，检查仓库是否有更新
    if (cacheDoc.exists) {
      logWithTime('找到仓库缓存，检查仓库是否有更新');
      const cacheData = cacheDoc.data() as CacheData || {};
      
      // 获取缓存更新时间，兼容不同格式
      let cacheUpdateTime: Date;
      
      // 处理可能的updatedAt格式
      const updatedAt = cacheData.updatedAt;
      if (updatedAt) {
        if (typeof updatedAt === 'object' && updatedAt !== null && 'toDate' in updatedAt && typeof updatedAt.toDate === 'function') {
          // Firestore Timestamp
          cacheUpdateTime = updatedAt.toDate();
        } else if (updatedAt instanceof Date) {
          // JavaScript Date
          cacheUpdateTime = updatedAt;
        } else {
          // 字符串或其他格式
          try {
            cacheUpdateTime = new Date(String(updatedAt));
          } catch (error) {
            // 如果转换失败，设为很久以前
            console.log('日期转换失败:', error);
            cacheUpdateTime = new Date(0);
          }
        }
      } else {
        // 没有更新时间，设为很久以前
        cacheUpdateTime = new Date(0);
      }
      
      // 计算缓存年龄（小时）
      const cacheAgeHours = (Date.now() - cacheUpdateTime.getTime()) / (1000 * 60 * 60);
      
      // 如果缓存超过24小时，强制刷新
      const shouldForceRefresh = cacheAgeHours > 24;
      
      if (shouldForceRefresh) {
        logWithTime('缓存已超过24小时，强制刷新');
        
        // 清除内存缓存
        clearRepoCache(owner, repo);
        
        // 获取仓库文件
        const files = await getRepoFiles(owner, repo);
        
        // 生成仓库摘要
        const repoSummary = createMockRepoSummary(owner, repo);
        
        // 更新缓存
        await cacheRef.set({
          owner,
          repo,
          summary: repoSummary,
          files,
          updatedAt: new Date()
        });
        
        logWithTime('仓库缓存已强制刷新');
        
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
      }
      
      try {
        // 获取仓库最新更新时间
        const latestUpdateTime = await getRepoLatestUpdateTime(owner, repo);
        
        // 如果仓库有更新，重新获取数据
        if (latestUpdateTime > cacheUpdateTime) {
          logWithTime('仓库有更新，重新获取数据');
          
          // 清除内存缓存
          clearRepoCache(owner, repo);
          
          // 获取仓库文件
          const files = await getRepoFiles(owner, repo);
          
          // 生成仓库摘要
          const repoSummary = createMockRepoSummary(owner, repo);
          
          // 更新缓存
          await cacheRef.set({
            owner,
            repo,
            summary: repoSummary,
            files,
            updatedAt: new Date()
          });
          
          logWithTime('仓库缓存已更新');
          
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
        }
        
        // 仓库没有更新，使用缓存数据
        logWithTime('仓库没有更新，使用缓存数据');
        
        // 确保files是一个数组
        const files = Array.isArray(cacheData?.files) ? cacheData.files : [];
        
        // 生成与当前任务相关的文件列表
        const relevantFiles = getRelevantFilesForTask(
          files,
          currentTask,
          tasks,
          projectDetail,
          evidence,
        );
        
        // 确保summary是一个字符串
        const summary = typeof cacheData?.summary === 'string' ? cacheData.summary : '';
        
        return {
          repoSummary: summary || createMockRepoSummary(owner, repo),
          relevantFiles
        };
      } catch (error) {
        // 如果获取仓库更新时间失败，记录错误并使用缓存数据
        logError('获取仓库更新时间失败，使用缓存数据', error);
        
        // 确保files是一个数组
        const files = Array.isArray(cacheData?.files) ? cacheData.files : [];
        
        // 生成与当前任务相关的文件列表
        const relevantFiles = getRelevantFilesForTask(
          files,
          currentTask,
          tasks,
          projectDetail,
          evidence,
        );
        
        // 确保summary是一个字符串
        const summary = typeof cacheData?.summary === 'string' ? cacheData.summary : '';
        
        return {
          repoSummary: summary || createMockRepoSummary(owner, repo),
          relevantFiles
        };
      }
    }
    
    // 无缓存，获取仓库文件
    logWithTime('没有找到缓存，获取仓库文件');
    const files = await getRepoFiles(owner, repo);
    
    // 生成仓库摘要
    const repoSummary = createMockRepoSummary(owner, repo);
    
    // 保存到缓存
    await cacheRef.set({
      owner,
      repo,
      summary: repoSummary,
      files,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    logWithTime('仓库数据已保存到缓存');
    
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
    logError('处理GitHub仓库失败', error);
    throw new Error(`处理GitHub仓库失败: ${(error as Error).message}`);
  }
}

/**
 * 获取仓库文件
 */
async function getRepoFiles(owner: string, repo: string): Promise<Array<{path: string; content: string}>> {
  logWithTime(`获取仓库文件: ${owner}/${repo}`);
  
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
            logError(`获取文件内容失败: ${current.path}`, error);
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
            logError(`获取目录内容失败: ${current.path}`, error);
            // 跳过这个目录，继续处理其他文件和目录
          }
        }
      }
    }
    
    logWithTime(`获取到${result.length}个文件`);
    return result;
  } catch (error) {
    logError('获取仓库文件失败', error);
    throw new Error(`获取仓库文件失败: ${(error as Error).message}`);
  }
}

/**
 * 获取文件内容
 */
async function getFileContent(owner: string, repo: string, path: string): Promise<string> {
  try {
    // 使用修改后的GitHub模块获取文件内容
    const content = await getRepositoryFiles(owner, repo, path)
      .then(result => {
        if (Array.isArray(result) && result.length === 1 && result[0].content) {
          return result[0].content;
        }
        throw new Error('获取文件内容失败');
      });
    
    return content;
  } catch (error) {
    throw new Error(`获取文件内容失败: ${(error as Error).message}`);
  }
}

/**
 * 判断是否应该包含该文件
 */
function shouldIncludeFile(path: string): boolean {
  // 排除二进制文件、图像、字体等
  const excludeExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico',
    '.pdf', '.zip', '.tar', '.gz', '.rar',
    '.mp3', '.mp4', '.avi', '.mov',
    '.ttf', '.woff', '.woff2',
    '.lock', '.map', '.json', '.yaml', '.mjs', '.gitignore'
  ];
  
  // 排除node_modules、构建目录等
  const excludeDirs = [
    'node_modules/',
    'dist/',
    'build/',
    '.git/',
    '.github/',
    '.vscode/',
    'vendor/'
  ];
  
  // 检查文件扩展名
  const hasExcludedExtension = excludeExtensions.some(ext => 
    path.toLowerCase().endsWith(ext)
  );
  
  // 检查是否在排除目录中
  const isInExcludedDir = excludeDirs.some(dir => 
    path.includes(dir)
  );
  
  return !hasExcludedExtension && !isInExcludedDir;
}

/**
 * 判断是否应该包含该目录
 */
function shouldIncludeDirectory(path: string): boolean {
  // 排除node_modules、构建目录等
  const excludeDirs = [
    'node_modules',
    'dist',
    'build',
    '.git',
    '.github',
    '.vscode',
    'vendor'
  ];
  
  return !excludeDirs.some(dir => 
    path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`)
  );
}

/**
 * 创建模拟仓库摘要
 */
function createMockRepoSummary(owner: string, repo: string): string {
  return `GitHub仓库：${owner}/${repo}

由于没有自动摘要生成功能，这里只提供基本仓库信息，不包含具体代码分析。`;
}

/**
 * 根据当前任务获取相关文件
 */
function getRelevantFilesForTask(
files: Array<{ path: string; content: string; }>, currentTask: string, 
tasks: string[], 
projectDetail: string, evidence: string): Array<{path: string; content: string; relevance: number}> {
  logWithTime('根据任务筛选相关文件');
  logWithTime(`任务: ${currentTask}`);
  
  // 安全地获取字符串子串，处理非字符串输入
  const safeSubstring = (text: unknown, start: number, end: number): string => {
    if (typeof text !== 'string') {
      return String(text || '').substring(start, end);
    }
    return text.substring(start, end);
  };
  
  // 确保tasks是数组
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  
  // 安全地记录信息
  logWithTime(`证据: ${safeSubstring(evidence, 0, 100)}...`);
  logWithTime(`项目详情: ${safeSubstring(projectDetail, 0, 100)}...`);
  logWithTime(`子任务数量: ${safeTasks.length}`);
  
  // 创建一个相关性评分函数
  const getRelevanceScore = (
    filePath: string, 
    fileContent: string, 
    task: string,
    allTasks: string[],
    projectDetail: string,
    evidence: string
  ): number => {
    // 将路径和内容转为小写，用于不区分大小写的匹配
    const lowerPath = filePath.toLowerCase();
    const lowerContent = fileContent.toLowerCase();
    
    // 基础分数
    let score = 0;
    
    // 转义正则表达式特殊字符
    const escapeRegExp = (string: string): string => {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };
    
    // 辅助函数：计算关键词匹配分数
    const calculateWordMatchScore = (
      text: string, 
      pathWeight: number, 
      contentWeight: number
    ): number => {
      // 确保text是字符串
      if (typeof text !== 'string') {
        text = String(text || '');
      }
      
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
          logError(`正则表达式匹配失败, 单词: ${word}`, error);
          // 继续处理其他单词
        }
      }
      
      return matchScore;
    };
    
    // 确保所有输入都是字符串
    const safeTask = typeof task === 'string' ? task : String(task || '');
    const safeProjectDetail = typeof projectDetail === 'string' ? projectDetail : String(projectDetail || '');
    const safeEvidence = typeof evidence === 'string' ? evidence : String(evidence || '');
    
    // 1. 当前任务评分 - 较高权重
    score += calculateWordMatchScore(safeTask, 0.2, 0.05);
    
    // 2. 所有子任务评分 - 中等权重
    // 排除当前任务，避免重复计算
    const otherTasks = allTasks.filter(t => t !== task);
    for (const subTask of otherTasks.slice(0, 5)) { // 最多处理5个其他任务
      score += calculateWordMatchScore(subTask, 0.1, 0.03);
    }
    
    // 3. 项目详情评分 - 较低权重
    score += calculateWordMatchScore(safeProjectDetail, 0.05, 0.02);
    
    // 4. 证据评分 - 最高权重
    score += calculateWordMatchScore(safeEvidence, 0.4, 0.1);
    
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
  };
  
  // 计算每个文件的相关性
  const scoredFiles = files.map(file => {
    const relevance = getRelevanceScore(
      file.path, 
      file.content, 
      currentTask,
      Array.isArray(tasks) ? tasks : [],
      projectDetail || '',
      evidence || ''
    );
    return {
      ...file,
      relevance
    };
  });
  
  // 按相关性排序并选择前5个文件
  const sortedFiles = scoredFiles
    .sort((a, b) => b.relevance - a.relevance);
    // 不再限制文件数量
  
  logWithTime(`按相关性排序后，返回 ${sortedFiles.length} 个文件`);
  sortedFiles.forEach((file, index) => {
    if (index < 10) { // 只记录前10个文件以避免日志过长
      logWithTime(`相关文件 ${index+1}: ${file.path} (相关性: ${file.relevance.toFixed(2)})`);
    }
  });
  
  return sortedFiles;
} 