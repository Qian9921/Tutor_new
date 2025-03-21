import { OpenAI } from 'openai';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [QWEN API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [QWEN API] ${message}`);
  }
}

function logError(message: string, error: any) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [QWEN API ERROR] ${message}`, error);
  console.error(`Stack: ${error.stack || 'No stack trace'}`);
}

// 尝试不同的API基础URL
const API_BASE_URLS = [
  'https://dashscope.aliyuncs.com/compatible-mode/v1'          // 通义千问API
];

// 创建OpenAI客户端
function createOpenAIClient(baseURL: string) {
  return new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
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
  subtasks: string[];
  currentTask: string;
  githubRepoUrl: string;
  repoSummary: string;
  relevantFiles: Array<{ path: string; content: string; relevance: number }>;
}

// API响应类型
export interface CodeEvaluationResult {
  detailedReport: string; // 详细评价报告
  rawContent?: string; // 原始响应内容
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
  logWithTime('相关文件数量: ' + params.relevantFiles.length);

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
    subtasks: params.subtasks,
    current_task: params.currentTask,
    github_repo_url: params.githubRepoUrl,
    repo_summary: params.repoSummary,
    relevant_files: params.relevantFiles.map(file => ({
      path: file.path,
      content: file.content,
      relevance: file.relevance
    }))
  };

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
        model: 'qwen-plus', // 通义千问模型
        messages: [
          {
            role: 'system',
            content: `请按以下要求分析：
1. 完成度评分 (0-1的小数，两位精度)
   - 示例：0.68（完成基础功能但缺少异常处理）
   
2. 评估理由（使用符号标注）：
   ✅ 已完成功能
   ❌ 缺失功能
   ⚠️ 安全隐患（包含[!]紧急标记）
   现在包含什么内容：
   
3. 改进建议prompt（按优先级排序）：
   - 每个prompt必须包含操作指令（如"分三步"、"举例说明"）
   - 前两个建议必须包含代码示例要求

以严格JSON格式返回：
{
  "assessment": 0.75, // 评分需体现加权计算结果
  "reasoning": "符号化评估说明（最少6个关键点）", 
  "improvements": ["可执行的prompt指令"]
}`
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

      let responseData: any = {};
      let isJson = true;

      try {
        // 尝试解析为JSON
        if (responseContent.trim()) {
          responseData = JSON.parse(responseContent);
        }
      } catch (parseError) {
        // 解析失败，使用原始文本
        isJson = false;
        logWithTime('响应不是JSON格式，将作为文本处理');
      }

      // 返回结果
      let result: CodeEvaluationResult;

      if (isJson) {
        // 处理JSON格式响应
        result = {
          detailedReport: responseData.detailed_report || '',
          rawContent: responseContent
        };
      } else {
        // 处理文本格式响应
        result = {
          detailedReport: responseContent,
          rawContent: responseContent // 使用原始内容作为报告
        };
      }

      logWithTime('评估结果', result);
      return result;
    } catch (error: any) {
      lastError = error;
      retryCount++;

      // 详细记录错误信息
      let errorMessage = `评估请求失败: ${error.message}`;
      if (error.code === 'ENOTFOUND') {
        errorMessage = `DNS解析失败，无法连接到API服务器 (${API_BASE_URLS[currentUrlIndex]}): ${error.message}`;
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = `连接超时: ${error.message}`;
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = `连接被拒绝: ${error.message}`;
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
  return {
    detailedReport: `
      请按以下要求分析：
1. 完成度评分 (0-1的小数，两位精度)
   - 示例：0.68（完成基础功能但缺少异常处理）
   
2. 评估理由（使用符号标注）：
   ✅ 已完成功能
   ❌ 缺失功能 
   ⚠️ 安全隐患（包含[!]紧急标记）
   现在包含什么内容：
   
3. 改进建议prompt（按优先级排序）：
   - 每个prompt必须包含操作指令（如"分三步"、"举例说明"）
   - 前两个建议必须包含代码示例要求

以严格JSON格式返回：
{
  "assessment": 0.75, // 评分需体现加权计算结果
  "reasoning": "符号化评估说明（最少4个关键点）", 
  "improvements": ["可执行的prompt指令"]
}

示例响应：
${JSON.stringify({
      assessment: 0.68,
      reasoning: "✅用户登录正常 | ❌缺少密码重置 | ⚠️无验证码防爆破[!]",
      improvements: [
        "如何实现短信验证码登录？分三步解释并给出Python示例",
        "用Flask添加密码重置功能，包含邮件发送的完整代码",
        "列举5种防暴力破解方案并给出代码片段"
      ]
    }, null, 2)}
`
  };
}