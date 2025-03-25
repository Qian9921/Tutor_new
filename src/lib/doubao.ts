import { OpenAI } from 'openai';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [QWEN API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [QWEN API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [QWEN API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 尝试不同的API基础URL
const API_BASE_URLS = [
  //'https://dashscope.aliyuncs.com/compatible-mode/v1' 
  'https://generativelanguage.googleapis.com/v1beta/openai/'       // 通义千问API
];

// 创建OpenAI客户端
function createOpenAIClient(baseURL: string) {
  const apiKey = process.env.DASHSCOPE_API_KEY || 'dummy-key';

  return new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
    timeout: 600000, // 60秒超时
    maxRetries: 0,  // 我们自己处理重试
  });
}

// 初始化默认客户端
let openai = createOpenAIClient(API_BASE_URLS[0]);

// API请求参数类型
export interface CodeEvaluationParams {
  projectDetail: string;
  tasks: string[];
  currentTask: string;
  evidence: string;
  githubRepoUrl: string;
  repoSummary: string;
  relevantFiles: Array<{ path: string; content: string; relevance: number }>;
}

// API响应类型
export interface CodeEvaluationResult {
  rawContent?: any; // 原始响应内容，可以是任何解析后的JSON对象
}

// 判断是否应该使用模拟数据
function shouldUseMockData() {
  // 开发环境且没有API密钥，或者强制使用模拟数据的环境变量
  return (process.env.NODE_ENV === 'development' && !process.env.DASHSCOPE_API_KEY) ||
    process.env.USE_MOCK_DATA === 'true';
}

/**
 * 评估代码
 */
export async function evaluateCode(params: CodeEvaluationParams): Promise<CodeEvaluationResult> {
  logWithTime('开始代码评估');
  logWithTime('项目: ' + params.projectDetail);
  //logWithTime('相关文件数量: ' + params.relevantFiles.length);

  // 如果设置了强制使用模拟数据，则直接返回
  if (shouldUseMockData()) {
    logWithTime('配置为使用模拟数据，跳过API调用');
    return getMockEvaluationResult();
  }

  // 最大重试次数
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  let currentUrlIndex = 0;

  // 准备请求数据
  const requestData = {
    project_detail: params.projectDetail,
    tasks: params.tasks,
    current_task: params.currentTask,
    evidence: params.evidence,
    github_repo_url: params.githubRepoUrl,
    repo_summary: params.repoSummary,
    relevant_files: processRelevantFiles(params.relevantFiles)
  };

  // 处理文件内容，限制长度避免超出token限制
  function processRelevantFiles(files: Array<{ path: string; content: string; relevance: number }>) {
    const MAX_TOTAL_CHARS = 100000; // 保守估计，避免超出模型限制
    const MAX_FILE_SIZE = 15000;    // 单个文件最大长度

    // 优先保留相关性高的文件
    const sortedFiles = [...files].sort((a, b) => b.relevance - a.relevance);

    // 截断内容的辅助函数
    const truncateContent = (content: string, maxLength: number): string => {
      if (!content || content.length <= maxLength) return content;

      // 保留文件开头和结尾
      const headSize = Math.floor(maxLength * 0.6);
      const tailSize = Math.floor(maxLength * 0.4);
      const head = content.substring(0, headSize);
      const tail = content.substring(content.length - tailSize);

      return `${head}\n\n... [内容已截断，省略${content.length - headSize - tailSize}字符] ...\n\n${tail}`;
    };

    // 先截断单个文件
    const processedFiles = sortedFiles.map(file => ({
      path: file.path,
      content: truncateContent(file.content, MAX_FILE_SIZE),
      relevance: file.relevance
    }));

    // 估计总大小
    let totalSize = JSON.stringify(processedFiles).length;

    // 如果仍然超出限制，则减少文件数量
    while (totalSize > MAX_TOTAL_CHARS && processedFiles.length > 1) {
      // 移除相关性最低的文件
      processedFiles.pop();
      totalSize = JSON.stringify(processedFiles).length;
    }

    logWithTime(`处理后的文件数量: ${processedFiles.length}，估计总字符数: ${totalSize}`);
    return processedFiles;
  }

  while (retryCount < maxRetries) {
    try {
      // 对于每个新的重试循环，尝试切换API基础URL
      if (retryCount > 0 && currentUrlIndex < API_BASE_URLS.length - 1) {
        currentUrlIndex++;
        const newBaseURL = API_BASE_URLS[currentUrlIndex];
        logWithTime(`切换到备用API基础URL: ${newBaseURL}`);
        openai = createOpenAIClient(newBaseURL);
      }

      logWithTime(`发送评估请求到通义千问API${retryCount > 0 ? ` (尝试 ${retryCount + 1}/${maxRetries})` : ''}`);

      // 打印请求数据
      logWithTime('请求数据', requestData);

      // 使用OpenAI SDK发送请求
      const response = await openai.chat.completions.create({
        model: 'gemini-2.0-flash', // 通义千问模型
        messages: [
          {
            role: 'system',
            content: `你是一位代码评估专家，请根据以下信息评估GitHub仓库的代码完成度：

【评估步骤】
1. 仔细阅读所有信息：项目详情(projectDetail)、任务列表(tasks)、当前任务(currentTask)和完成标准(evidence)
2. 重点查看代码文件(relevantFiles)，检查是否满足evidence中列出的所有完成标准
3. 对照evidence中的每个检查点，逐一评估代码实现情况
4. 根据评估结果计算0-1之间的完成度评分
5. 提供分析和改进建议

【评分标准】
- 1.0: 完美实现所有evidence中的要求，代码质量高
- 0.8: 实现了大部分要求，可能有小问题
- 0.6: 基本功能已实现，但存在明显缺陷
- 0.4: 部分功能实现，多数要求未满足
- 0.2: 少量功能实现，大部分要求未满足
- 0.0: 几乎没有实现evidence中的要求

【输出格式】
请提供JSON格式的评估结果：
{
  "assessment": 0.xx, // 完成度评分(0-1之间的小数，保留两位)
  "checkpoints": [
    {"requirement": "检查点1", "status": "✅ 已完成", "details": "实现分析..."},
    {"requirement": "检查点2", "status": "❌ 未完成", "details": "缺失原因..."},
    {"requirement": "检查点3", "status": "⚠️ 部分完成", "details": "问题分析..."}
  ],
  "summary": "总体代码评估，包含至少6个关键点，使用✅❌⚠️符号标注",
  "improvements": [
    "改进建议1：请详细说明如何实现X功能，包括需要修改的文件和具体代码示例",
    "改进建议2：请分三步解释如何解决Y问题，并给出完整实现思路"
  ]
}

注意：
- evidence是评估的核心标准，必须严格按照其中的每个检查点评估
- 改进建议必须具体、可执行，包含明确的操作指令
- 所有分析必须基于提供的代码文件和项目上下文
- 评分必须客观公正，与检查点完成情况一致`
          },
          {
            role: 'user',
            content: JSON.stringify(requestData)
          }
        ],
        temperature: 0,
      });

      logWithTime('评估请求成功');

      // 解析响应内容
      const responseContent = response.choices[0]?.message?.content || '';
      logWithTime('原始响应内容', responseContent);

      let result: CodeEvaluationResult;

      try {
        // 尝试解析为JSON
        if (responseContent.trim()) {
          // 解析JSON响应
          const parsedResponse = JSON.parse(responseContent);
          // 返回解析后的对象
          result = {
            rawContent: parsedResponse
          };
        } else {
          // 空响应处理
          result = {
            rawContent: {
              message: "API返回了空响应",
              isJsonFormat: false
            }
          };
        }
      } catch (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      parseError
      ) {
        // 解析失败，返回包装的对象
        logWithTime('响应不是JSON格式，将作为文本处理');
        result = {
          rawContent: {
            responseContent,
            
          }
        };
      }

      logWithTime('评估结果', result);
      return result;
    } catch (error: unknown) {
      lastError = error;
      retryCount++;

      // 详细记录错误信息
      let errorMessage = `评估请求失败: ${(error as Error).message}`;
      if ((error as { code?: string }).code === 'ENOTFOUND') {
        errorMessage = `DNS解析失败，无法连接到API服务器 (${API_BASE_URLS[currentUrlIndex]}): ${(error as Error).message}`;
      } else if ((error as { code?: string }).code === 'ETIMEDOUT') {
        errorMessage = `连接超时: ${(error as Error).message}`;
      } else if ((error as { code?: string }).code === 'ECONNREFUSED') {
        errorMessage = `连接被拒绝: ${(error as Error).message}`;
      }

      logError(errorMessage, error);

      // 记录重试信息
      if (retryCount < maxRetries) {
        logWithTime(`评估请求失败，正在进行第${retryCount}次重试，共${maxRetries}次`);
        // 等待一段时间后再尝试
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      } else {
        // 最后一次尝试也失败了
        logError('代码评估失败，达到最大重试次数', lastError);

        // 在所有API尝试失败，且在开发环境中，返回mock数据
        if (process.env.NODE_ENV === 'development') {
          logWithTime('在API连接失败后使用Mock数据');
          return getMockEvaluationResult();
        }
      }
    }
  }

  throw new Error(`代码评估失败: ${(lastError as Error).message}`);
}

/**
 * 获取模拟评估结果（开发/测试环境使用）
 */
function getMockEvaluationResult(): CodeEvaluationResult {
  logWithTime('返回模拟评估结果');
  
  // 直接返回JavaScript对象
  return {
    rawContent: {
      assessment: 0.68,
      checkpoints: [
        {requirement: "用户登录功能", status: "✅ 已完成", details: "登录功能正常工作"},
        {requirement: "密码重置功能", status: "❌ 未完成", details: "缺少密码重置流程"},
        {requirement: "安全防护机制", status: "⚠️ 部分完成", details: "缺少验证码防爆破保护"}
      ],
      summary: "✅登录流程完整 | ✅UI交互友好 | ❌缺少密码重置 | ❌没有记住登录状态 | ⚠️无验证码防爆破 | ⚠️密码强度检测不足",
      improvements: [
        "改进建议1：请详细说明如何实现短信验证码登录功能，包括需要修改的文件和具体代码示例",
        "改进建议2：请分三步解释如何添加密码重置功能，并给出完整实现思路和代码示例",
        "改进建议3：请提供5种防止暴力破解登录的方案"
      ]
    }
  };
}