import NodeCache from 'node-cache';
import { Octokit } from '@octokit/rest';

import { logError, logWithTime } from './logger';

const MODULE_NAME = 'GITHUB API';
const githubCache = new NodeCache({ stdTTL: 60 * 5, checkperiod: 60 });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

interface GitHubContentItem {
  name: string;
  path: string;
  type: string;
  content?: string;
}

interface GitHubTreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
  url?: string;
}

export interface GitHubTreeFile {
  path: string;
  sha: string;
  size?: number;
  type: 'blob' | 'tree';
}

function getCacheKey(...parts: string[]) {
  return parts.join('::');
}

function cleanContent(content: string, filePath: string) {
  const binaryExtensions = [
    '.lock', '.bin', '.exe', '.dll', '.so', '.dylib', '.png', '.jpg', '.jpeg', '.gif',
    '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.pdf', '.mp4', '.mp3',
  ];
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

  if (binaryExtensions.includes(ext)) {
    return `[Binary file: ${filePath}]`;
  }

  return content.replace(/\u0000/g, '').replace(/[\uD800-\uDFFF]/g, '');
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  logWithTime(MODULE_NAME, `解析GitHub URL: ${url}`);

  try {
    const trimmed = url.trim().replace(/\.git$/, '').replace(/\/$/, '');

    if (trimmed.startsWith('git@github.com:')) {
      const path = trimmed.replace('git@github.com:', '');
      const [owner, repo] = path.split('/');
      if (!owner || !repo) {
        throw new Error(`无法从SSH URL解析owner和repo: ${url}`);
      }
      return { owner, repo };
    }

    const urlObj = new URL(trimmed);
    const path = urlObj.pathname.replace(/^\//, '');
    const [owner, repo] = path.split('/');

    if (!owner || !repo) {
      throw new Error(`无法从URL解析owner和repo: ${url}`);
    }

    logWithTime(MODULE_NAME, `GitHub URL解析结果: owner=${owner}, repo=${repo}`);
    return { owner, repo };
  } catch (error) {
    logError(MODULE_NAME, `解析GitHub URL失败: ${url}`, error);
    throw new Error(`解析GitHub URL失败: ${(error as Error).message}`);
  }
}

async function getDefaultBranch(owner: string, repo: string) {
  const cacheKey = getCacheKey('default-branch', owner, repo);
  const cached = githubCache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await octokit.repos.get({ owner, repo });
  const branch = response.data.default_branch || 'main';
  githubCache.set(cacheKey, branch);
  return branch;
}

export async function getRepositoryTree(owner: string, repo: string): Promise<GitHubTreeFile[]> {
  const cacheKey = getCacheKey('tree', owner, repo);
  const cached = githubCache.get<GitHubTreeFile[]>(cacheKey);
  if (cached) {
    logWithTime(MODULE_NAME, `使用缓存的仓库树: ${owner}/${repo}`);
    return cached;
  }

  try {
    const branch = await getDefaultBranch(owner, repo);
    const branchResponse = await octokit.repos.getBranch({ owner, repo, branch });
    const treeSha = branchResponse.data.commit.commit.tree.sha;

    const response = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true',
    });

    const tree = (response.data.tree || [])
      .filter((item: GitHubTreeEntry) => item.path && item.type && item.sha)
      .map((item: GitHubTreeEntry) => ({
        path: item.path as string,
        sha: item.sha as string,
        size: item.size,
        type: item.type as 'blob' | 'tree',
      }));

    githubCache.set(cacheKey, tree);
    logWithTime(MODULE_NAME, `获取仓库树成功: ${owner}/${repo} (${tree.length} 项)`);
    return tree;
  } catch (error) {
    logError(MODULE_NAME, `获取仓库树失败: ${owner}/${repo}`, error);
    throw new Error(`获取仓库树失败: ${(error as Error).message}`);
  }
}

export async function getFileContentBySha(owner: string, repo: string, path: string, sha: string): Promise<string> {
  const cacheKey = getCacheKey('blob', owner, repo, sha);
  const cached = githubCache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await octokit.git.getBlob({ owner, repo, file_sha: sha });
    const content = cleanContent(Buffer.from(response.data.content, 'base64').toString(), path);
    githubCache.set(cacheKey, content);
    return content;
  } catch (error) {
    logError(MODULE_NAME, `通过SHA获取文件内容失败: ${path}`, error);
    throw new Error(`通过SHA获取文件内容失败: ${(error as Error).message}`);
  }
}

export async function getRepositoryFiles(
  owner: string,
  repo: string,
  path = ''
): Promise<Array<{ name: string; path: string; type: string; content?: string }>> {
  logWithTime(MODULE_NAME, `获取仓库文件: ${owner}/${repo}, 路径: ${path || '根目录'}`);

  try {
    const response = await octokit.repos.getContent({ owner, repo, path });

    if (!Array.isArray(response.data)) {
      return [
        {
          name: response.data.name,
          path: response.data.path,
          type: response.data.type,
          content:
            'content' in response.data && response.data.content
              ? cleanContent(Buffer.from(response.data.content, 'base64').toString(), response.data.path)
              : undefined,
        },
      ];
    }

    return response.data.map((item: GitHubContentItem) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      content:
        'content' in item && item.content
          ? cleanContent(Buffer.from(item.content, 'base64').toString(), item.path)
          : undefined,
    }));
  } catch (error) {
    logError(MODULE_NAME, `获取仓库文件失败: ${owner}/${repo}/${path}`, error);
    throw new Error(`获取GitHub仓库文件失败: ${(error as Error).message}`);
  }
}

export async function getFileContent(owner: string, repo: string, path: string): Promise<string> {
  logWithTime(MODULE_NAME, `获取文件内容: ${owner}/${repo}/${path}`);

  try {
    const response = await octokit.repos.getContent({ owner, repo, path });

    if (Array.isArray(response.data) || !('content' in response.data) || !response.data.content) {
      throw new Error(`请求的路径不是一个文件或没有内容: ${path}`);
    }

    return cleanContent(Buffer.from(response.data.content, 'base64').toString(), path);
  } catch (error) {
    logError(MODULE_NAME, `获取文件内容失败: ${owner}/${repo}/${path}`, error);
    throw new Error(`获取文件内容失败: ${(error as Error).message}`);
  }
}

export async function getRepoLatestUpdateTime(owner: string, repo: string): Promise<Date> {
  logWithTime(MODULE_NAME, `获取仓库最新更新时间: ${owner}/${repo}`);

  try {
    const [repoResponse, commitsResponse] = await Promise.all([
      octokit.repos.get({ owner, repo }),
      octokit.repos.listCommits({ owner, repo, per_page: 1 }),
    ]);

    const repoUpdatedAt = new Date(repoResponse.data.updated_at);
    let latestCommitDate: Date | null = null;
    if (commitsResponse.data.length > 0 && commitsResponse.data[0].commit?.committer?.date) {
      latestCommitDate = new Date(commitsResponse.data[0].commit.committer.date);
    }

    return latestCommitDate && latestCommitDate > repoUpdatedAt ? latestCommitDate : repoUpdatedAt;
  } catch (error) {
    logError(MODULE_NAME, `获取仓库最新更新时间失败: ${owner}/${repo}`, error);
    throw new Error(`获取仓库最新更新时间失败: ${(error as Error).message}`);
  }
}

const githubApi = {
  parseGitHubUrl,
  getRepositoryFiles,
  getRepositoryTree,
  getFileContent,
  getFileContentBySha,
  getRepoLatestUpdateTime,
};

export default githubApi;
