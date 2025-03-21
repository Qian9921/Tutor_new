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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const repoCache = new NodeCache({ 
  stdTTL: 3600, // 1小时缓存
  checkperiod: 600, // 10分钟检查一次过期
  maxKeys: 100 // 最多缓存100个仓库
});

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
  
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    
    // 处理单文件或目录内容
    if (!Array.isArray(response.data)) {
      // 这是单个文件，是正常情况
      logWithTime(`获取到单个文件: ${owner}/${repo}/${path}`);
      return [
        {
          name: response.data.name,
          path: response.data.path,
          type: response.data.type,
          content: 'content' in response.data && response.data.content ? 
            cleanContent(Buffer.from(response.data.content, 'base64').toString(), response.data.path) : undefined,
        },
      ];
    }
    
    logWithTime(`获取到${response.data.length}个文件/目录`);
    return response.data.map((item: GitHubContentItem) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      // 仅当是文件且请求了单个文件时才会有content
      content: 'content' in item && item.content ? 
        cleanContent(Buffer.from(item.content, 'base64').toString(), item.path) : undefined,
    }));
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
    
    return content;
  } catch (error) {
    logError(`获取文件内容失败: ${owner}/${repo}/${path}`, error);
    throw new Error(`获取文件内容失败: ${(error as Error).message}`);
  }
}

// 创建导出对象
const githubApi = {
  parseGitHubUrl,
  getRepositoryFiles,
  getFileContent,
};

export default githubApi; 