// 创建一个简单的Document接口替代@llamaindex/core的导入
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Document {
  text: string;
  metadata: Record<string, unknown>;
}

import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { getRepositoryFiles, parseGitHubUrl } from './github';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { v4 as uuidv4 } from 'uuid';

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

/**
 * 处理GitHub仓库
 */
export async function processGitHubRepository(
  githubRepoUrl: string,
  projectDetail: string,
  subtasks: string[],
  currentTask: string
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
    
    // 如果有缓存，使用缓存数据
    if (cacheDoc.exists) {
      logWithTime('找到仓库缓存，使用缓存数据');
      const cacheData = cacheDoc.data();
      
      // 生成与当前任务相关的文件列表
      const relevantFiles = getRelevantFilesForTask(
        cacheData.files || [],
        currentTask,
        subtasks,
        projectDetail
      );
      
      return {
        repoSummary: cacheData.summary || createMockRepoSummary(owner, repo),
        relevantFiles
      };
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
      subtasks,
      projectDetail
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
    '.lock', '.map'
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
  return `这是一个名为 ${repo} 的GitHub仓库，由 ${owner} 创建和维护。

仓库结构总览:
- 主要使用JavaScript/TypeScript
- 包含典型的React项目结构
- 使用了Next.js框架
- 包含API路由和页面组件
- 使用TailwindCSS进行样式设计
- 实现了用户认证功能
- 包含数据库连接和操作
- 具有GitHub集成功能

主要功能:
- 代码评估系统
- GitHub仓库分析
- 用户认证和授权
- 数据可视化
- API集成

这个仓库实现了一个代码评估系统，可以分析GitHub仓库中的代码质量和结构。`;
}

/**
 * 根据当前任务获取相关文件
 */
function getRelevantFilesForTask(
  files: Array<{path: string; content: string}>,
  currentTask: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  subtasks: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectDetail: string
): Array<{path: string; content: string; relevance: number}> {
  logWithTime('根据任务筛选相关文件');
  logWithTime(`任务: ${currentTask}`);
  
  // 创建一个简单的相关性评分函数
  const getRelevanceScore = (
    filePath: string, 
    fileContent: string, 
    task: string
  ): number => {
    // 简化的相关性评分算法
    // 实际实现中，这里应该使用更复杂的相似度算法或AI模型
    
    // 将任务和文件内容转为小写，用于不区分大小写的匹配
    const lowerTask = task.toLowerCase();
    const lowerPath = filePath.toLowerCase();
    const lowerContent = fileContent.toLowerCase();
    
    // 基础分数
    let score = 0;
    
    // 文件路径中包含任务关键词加分
    const taskWords = lowerTask.split(/\s+/);
    for (const word of taskWords) {
      if (word.length > 3 && lowerPath.includes(word)) {
        score += 0.3;
      }
    }
    
    // 文件内容中包含任务关键词加分
    for (const word of taskWords) {
      if (word.length > 3) {
        const regex = new RegExp(word, 'gi');
        const matches = lowerContent.match(regex);
        if (matches) {
          score += 0.1 * Math.min(matches.length, 10); // 最多加1分
        }
      }
    }
    
    // 根据文件类型加分
    if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) {
      score += 0.2; // TypeScript文件加分
    }
    if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) {
      score += 0.15; // JavaScript文件加分
    }
    if (lowerPath.includes('/api/')) {
      score += 0.25; // API相关文件加分
    }
    if (lowerPath.includes('/components/')) {
      score += 0.2; // 组件文件加分
    }
    if (lowerPath.includes('/pages/') || lowerPath.includes('/app/')) {
      score += 0.2; // 页面文件加分
    }
    if (lowerPath.includes('/lib/') || lowerPath.includes('/utils/')) {
      score += 0.2; // 库和工具文件加分
    }
    
    // 规范化分数到0-1范围
    score = Math.min(Math.max(score, 0), 1);
    
    return score;
  };
  
  // 计算每个文件的相关性
  const scoredFiles = files.map(file => {
    const relevance = getRelevanceScore(file.path, file.content, currentTask);
    return {
      ...file,
      relevance
    };
  });
  
  // 按相关性排序并选择前10个文件
  const sortedFiles = scoredFiles
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10); // 限制最多10个文件
  
  logWithTime(`筛选出${sortedFiles.length}个相关文件`);
  
  return sortedFiles;
} 