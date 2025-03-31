import { Octokit } from '@octokit/rest';
import NodeCache from 'node-cache';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [GITHUB API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [GITHUB API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [GITHUB API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 清理文件内容，移除无效Unicode字符
function cleanContent(content: string, filePath: string): string {
  // 检查文件扩展名，判断是否可能是二进制文件
  const binaryExtensions = ['.lock', '.bin', '.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  
  if (binaryExtensions.includes(ext)) {
    // 对于可能的二进制文件，返回一个说明而不是实际内容
    return `[Binary file: ${filePath}]`;
  }
  
  // 移除空字符和其他无效字符
  return content.replace(/\u0000/g, '').replace(/[\uD800-\uDFFF]/g, '');
}

// 解析GitHub仓库URL
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  logWithTime(`解析GitHub URL: ${url}`);
  
  try {
    // 移除URL末尾的.git (如果有)
    const cleanUrl = url.endsWith('.git') ? url.slice(0, -4) : url;
    
    // 从URL中提取owner和repo
    const urlObj = new URL(cleanUrl);
    const path = urlObj.pathname.replace(/^\//, ''); // 移除开头的斜杠
    const [owner, repo] = path.split('/');
    
    if (!owner || !repo) {
      throw new Error(`无法从URL解析owner和repo: ${url}`);
    }
    
    logWithTime(`GitHub URL解析结果: owner=${owner}, repo=${repo}`);
    return { owner, repo };
  } catch (error) {
    logError(`解析GitHub URL失败: ${url}`, error);
    throw new Error(`解析GitHub URL失败: ${(error as Error).message}`);
  }
}

// 初始化GitHub客户端
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// 创建缓存实例，设置1小时过期
const repoCache = new NodeCache({ 
  stdTTL: 3600, // 1小时缓存
  checkperiod: 600, // 10分钟检查一次过期
  maxKeys: 100 // 最多缓存100个仓库
});

// 为仓库更新时间创建单独的缓存，设置更短的TTL
const repoUpdateTimeCache = new NodeCache({ 
  stdTTL: 300, // 5分钟缓存
  checkperiod: 60, // 1分钟检查一次过期
  maxKeys: 100 // 最多缓存100个仓库
});

// 生成缓存键
function generateCacheKey(owner: string, repo: string, path: string = ''): string {
  return `${owner}:${repo}:${path}`;
}

// 生成仓库信息缓存键
function generateRepoInfoCacheKey(owner: string, repo: string): string {
  return `info:${owner}:${repo}`;
}

// 为GitHub API响应定义接口
interface GitHubContentItem {
  name: string;
  path: string;
  type: string;
  content?: string;
}

// 获取仓库文件
export async function getRepositoryFiles(
  owner: string,
  repo: string,
  path: string = ''
): Promise<Array<{name: string; path: string; type: string; content?: string}>> {
  logWithTime(`获取仓库文件: ${owner}/${repo}, 路径: ${path || '根目录'}`);
  
  // 生成缓存键
  const cacheKey = generateCacheKey(owner, repo, path);
  
  // 检查内存缓存
  const cachedFiles = repoCache.get<Array<{name: string; path: string; type: string; content?: string}>>(cacheKey);
  if (cachedFiles) {
    logWithTime(`从内存缓存获取到仓库文件: ${owner}/${repo}, 路径: ${path || '根目录'}`);
    return cachedFiles;
  }
  
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    
    let result: Array<{name: string; path: string; type: string; content?: string}>;
    
    // 处理单文件或目录内容
    if (!Array.isArray(response.data)) {
      // 这是单个文件，是正常情况
      logWithTime(`获取到单个文件: ${owner}/${repo}/${path}`);
      result = [
        {
          name: response.data.name,
          path: response.data.path,
          type: response.data.type,
          content: 'content' in response.data && response.data.content ? 
            cleanContent(Buffer.from(response.data.content, 'base64').toString(), response.data.path) : undefined,
        },
      ];
    } else {
      logWithTime(`获取到${response.data.length}个文件/目录`);
      result = response.data.map((item: GitHubContentItem) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        // 仅当是文件且请求了单个文件时才会有content
        content: 'content' in item && item.content ? 
          cleanContent(Buffer.from(item.content, 'base64').toString(), item.path) : undefined,
      }));
    }
    
    // 存入内存缓存
    repoCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    logError(`获取仓库文件失败: ${owner}/${repo}/${path}`, error);
    throw new Error(`获取GitHub仓库文件失败: ${(error as Error).message}`);
  }
}

// 获取文件内容
export async function getFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  logWithTime(`获取文件内容: ${owner}/${repo}/${path}`);
  
  // 生成缓存键
  const cacheKey = generateCacheKey(owner, repo, path);
  
  // 检查内存缓存
  const cachedFiles = repoCache.get<Array<{name: string; path: string; type: string; content?: string}>>(cacheKey);
  if (cachedFiles && cachedFiles.length === 1 && cachedFiles[0].content) {
    logWithTime(`从内存缓存获取到文件内容: ${owner}/${repo}/${path}`);
    return cachedFiles[0].content;
  }
  
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    
    // 检查是否是文件
    if (Array.isArray(response.data) || !('content' in response.data) || !response.data.content) {
      throw new Error(`请求的路径不是一个文件或没有内容: ${path}`);
    }
    
    const content = cleanContent(Buffer.from(response.data.content, 'base64').toString(), path);
    logWithTime(`获取文件内容成功: ${path} (${content.length} 字符)`);
    
    // 存入内存缓存
    repoCache.set(cacheKey, [{
      name: response.data.name,
      path: response.data.path,
      type: 'file',
      content: content
    }]);
    
    return content;
  } catch (error) {
    logError(`获取文件内容失败: ${owner}/${repo}/${path}`, error);
    throw new Error(`获取文件内容失败: ${(error as Error).message}`);
  }
}

// 获取仓库最新更新时间
export async function getRepoLatestUpdateTime(
  owner: string,
  repo: string
): Promise<Date> {
  logWithTime(`获取仓库最新更新时间: ${owner}/${repo}`);
  
  // 生成缓存键
  const cacheKey = generateRepoInfoCacheKey(owner, repo);
  
  // 检查内存缓存 - 使用更新时间专用缓存
  const cachedInfo = repoUpdateTimeCache.get<{updatedAt: Date}>(cacheKey);
  if (cachedInfo && cachedInfo.updatedAt) {
    logWithTime(`从内存缓存获取到仓库更新时间: ${owner}/${repo} - ${cachedInfo.updatedAt.toISOString()}`);
    return cachedInfo.updatedAt;
  }
  
  try {
    // 并行获取仓库信息和最新提交
    const [repoResponse, commitsResponse] = await Promise.all([
      octokit.repos.get({
        owner,
        repo,
      }),
      octokit.repos.listCommits({
        owner,
        repo,
        per_page: 1, // 只获取最新的提交
      }),
    ]);
    
    // 获取仓库更新时间
    const repoUpdatedAt = new Date(repoResponse.data.updated_at);
    logWithTime(`仓库API更新时间: ${repoUpdatedAt.toISOString()}`);
    
    // 获取最新提交时间（如果有）
    let latestCommitDate: Date | null = null;
    if (commitsResponse.data.length > 0 && commitsResponse.data[0].commit?.committer?.date) {
      latestCommitDate = new Date(commitsResponse.data[0].commit.committer.date);
      logWithTime(`最新提交时间: ${latestCommitDate.toISOString()}`);
    }
    
    // 使用最新的时间（仓库更新时间或提交时间）
    const updatedAt = latestCommitDate && latestCommitDate > repoUpdatedAt ? latestCommitDate : repoUpdatedAt;
    logWithTime(`确定的最新更新时间: ${updatedAt.toISOString()}`);
    
    // 存入内存缓存 - 使用更新时间专用缓存
    repoUpdateTimeCache.set(cacheKey, { updatedAt });
    
    return updatedAt;
  } catch (error) {
    logError(`获取仓库最新更新时间失败: ${owner}/${repo}`, error);
    throw new Error(`获取仓库最新更新时间失败: ${(error as Error).message}`);
  }
}

// 清除仓库的所有缓存
export function clearRepoCache(owner: string, repo: string): void {
  logWithTime(`清除仓库缓存: ${owner}/${repo}`);
  
  // 获取所有缓存键
  const allKeys = repoCache.keys();
  const allUpdateTimeKeys = repoUpdateTimeCache.keys();
  
  // 筛选并删除相关的缓存
  const repoPrefix = `${owner}:${repo}:`;
  const repoInfoKey = generateRepoInfoCacheKey(owner, repo);
  
  // 清除文件缓存
  allKeys.forEach(key => {
    if (key.startsWith(repoPrefix) || key === repoInfoKey) {
      repoCache.del(key);
    }
  });
  
  // 清除更新时间缓存
  allUpdateTimeKeys.forEach(key => {
    if (key === repoInfoKey) {
      repoUpdateTimeCache.del(key);
    }
  });
  
  logWithTime(`仓库缓存已清除: ${owner}/${repo}`);
}

// 创建导出对象
const githubApi = {
  parseGitHubUrl,
  getRepositoryFiles,
  getFileContent,
  getRepoLatestUpdateTime,
  clearRepoCache,
};

export default githubApi; 