import { OpenAI } from 'openai';
import { evaluateYouTubeVideo, extractJsonFromMarkdown as extractJsonFromMarkdownGemini } from './gemini';

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
  youtubeLink?: string; // 新增可选的YouTube链接
}

// API响应类型
export interface CodeEvaluationResult {
  rawContent?: any; // 原始响应内容，可以是任何解析后的JSON对象
}

// 添加视频评估结果接口
export interface VideoEvaluationResult {
  videoRawContent?: any;
  // videoRawContent: {
  //   presentationScore: number; // 演示评分
  //   summary: string; // 视频摘要
  //   codeVideoAlignment: Array<{ aspect: string; aligned: boolean; details: string }>; // 代码与视频的契合点
  //   overallFeedback: string; // 整体反馈
  // };
}

// 判断是否应该使用模拟数据
function shouldUseMockData() {
  // 开发环境且没有API密钥，或者强制使用模拟数据的环境变量
  return (process.env.NODE_ENV === 'development' && !process.env.DASHSCOPE_API_KEY) ||
    process.env.USE_MOCK_DATA === 'true';
}

/**
 * 尝试从可能包含Markdown代码块的文本中提取JSON
 */
function extractJsonFromMarkdown(text: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch (e) {
    // 记录直接解析失败的错误
    logWithTime('直接解析JSON失败:', e);
    
    // 直接解析失败，尝试提取代码块
    const jsonBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/m;
    const match = text.match(jsonBlockRegex);
    
    if (match && match[1]) {
      // 找到代码块，尝试解析其内容
      try {
        return JSON.parse(match[1]);
      } catch (innerError) {
        // 代码块内容解析失败
        logWithTime('代码块解析失败:', innerError);
      }
    }
    
    // 如果上述方法都失败，返回null
    return null;
  }
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
        //model: 'qwen-plus', // 通义千问模型
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
6. 尽可能多的在适当的位置使用适合的emoji来增加生动性，吸引用户的关注，让内容显得活泼生动
7. 至少在回答里用10个emoji，并且json格式可以识别
8. emoji不要瞎用，用在合适的地方，并且种类丰富一点

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
    {"requirement": "检查点1", "status": "已完成", "details": "实现分析..."},
    {"requirement": "检查点2", "status": "未完成", "details": "缺失原因..."},
    {"requirement": "检查点3", "status": "部分完成", "details": "问题分析..."}
  ], // 检查点要包含evidence里所有的检查点
  "summary": "总体代码评估，包含至少6个关键点",
  "improvements": [
    "改进建议1：请详细说明如何实现X功能，包括需要修改的文件和具体代码示例",
    "改进建议2：请分三步解释如何解决Y问题，并给出完整实现思路"
  ] // 改进建议越多越详细越好，但不要偏离evidence里的要求
}

注意：
- evidence是评估的核心标准，必须严格按照其中的每个检查点评估
- 改进建议必须具体、可执行，包含明确的操作指令
- 所有分析必须基于提供的代码文件和项目上下文
- 评分必须客观公正，与检查点完成情况一致
- 评估结果必须包含至少10个emoji
- 评估结果必须使用json格式
`
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

      // 尝试解析响应内容，包括可能的Markdown代码块
      const parsedContent = extractJsonFromMarkdown(responseContent);

      if (parsedContent) {
        // 解析成功
        result = {
          rawContent: parsedContent
        };
      } else {
        // 解析失败，返回包装的对象
        logWithTime('无法解析响应为JSON，将作为文本处理');
        result = {
          rawContent: {
            textContent: responseContent,
            isJsonFormat: false,
            message: "原始响应不是有效的JSON格式，已转换为对象"
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

/**
 * 文件分组工具 - 用于智能地将文件分到不同批次
 */
interface FileGroup {
  files: Array<{ path: string; content: string; relevance: number }>;
  totalSize: number;
  directoryScore: Record<string, number>;
}

/**
 * 批次评估结果
 */
interface BatchEvaluationResult {
  batch: number;
  totalBatches: number;
  result: CodeEvaluationResult;
  processedFiles: string[];
  success: boolean;
  error?: Error;
}

/**
 * 批次上下文 - 在批次之间传递的信息
 */
interface BatchContext {
  processedFiles: string[];
  keyInsights: string[];
  batchResults: BatchEvaluationResult[];
}

/**
 * 智能地将文件分批，确保相关文件尽量在同一批次
 */
function createSmartFileBatches(
  files: Array<{ path: string; content: string; relevance: number }>,
  maxBatchSize: number
): Array<Array<{ path: string; content: string; relevance: number }>> {
  // 如果文件总量很小，直接返回单个批次
  const totalSize = JSON.stringify(files).length;
  if (totalSize <= maxBatchSize) {
    return [files];
  }

  logWithTime(`开始智能文件分批，总文件数: ${files.length}`);

  // 按目录分组文件
  const directoryMap: Record<string, { path: string; content: string; relevance: number }[]> = {};
  
  for (const file of files) {
    const dirPath = file.path.split('/').slice(0, -1).join('/');
    if (!directoryMap[dirPath]) {
      directoryMap[dirPath] = [];
    }
    directoryMap[dirPath].push(file);
  }

  // 初始化批次组
  const fileGroups: FileGroup[] = [
    { files: [], totalSize: 0, directoryScore: {} }
  ];
  
  // 处理每个目录
  for (const dirPath in directoryMap) {
    const dirFiles = directoryMap[dirPath];
    
    // 计算该目录的文件总大小
    const dirSize = JSON.stringify(dirFiles).length;
    
    // 整个目录可以放入一个批次
    if (dirSize <= maxBatchSize * 0.8) {
      // 尝试找到最合适的组
      let bestGroupIndex = 0;
      let bestScore = -1;
      
      for (let i = 0; i < fileGroups.length; i++) {
        const group = fileGroups[i];
        
        // 检查容量
        if (group.totalSize + dirSize > maxBatchSize) {
          continue;
        }
        
        // 计算相关性评分 
        let score = group.directoryScore[dirPath] || 0;
        
        // 如果这个目录有已经存在于组中的上级目录，增加分数
        for (const existingDir in group.directoryScore) {
          if (dirPath.startsWith(existingDir)) {
            score += 2;
          } else if (existingDir.startsWith(dirPath)) {
            score += 2;
          }
        }
        
        // 找到最高评分的组
        if (score > bestScore || (score === bestScore && group.totalSize < fileGroups[bestGroupIndex].totalSize)) {
          bestScore = score;
          bestGroupIndex = i;
        }
      }
      
      // 如果找不到合适的组，创建一个新组
      if (bestScore < 0 || fileGroups[bestGroupIndex].totalSize + dirSize > maxBatchSize) {
        fileGroups.push({ 
          files: [...dirFiles], 
          totalSize: dirSize,
          directoryScore: { [dirPath]: 1 }
        });
      } else {
        // 将文件加入最合适的组
        const group = fileGroups[bestGroupIndex];
        group.files.push(...dirFiles);
        group.totalSize += dirSize;
        group.directoryScore[dirPath] = (group.directoryScore[dirPath] || 0) + 1;
      }
    } else {
      // 目录太大，需要拆分
      const tempFiles = [...dirFiles];
      
      // 按相关性排序
      tempFiles.sort((a, b) => b.relevance - a.relevance);
      
      // 逐个添加文件到组中
      for (const file of tempFiles) {
        const fileSize = JSON.stringify(file).length;
        
        // 寻找合适的组
        let added = false;
        for (const group of fileGroups) {
          if (group.totalSize + fileSize <= maxBatchSize) {
            group.files.push(file);
            group.totalSize += fileSize;
            group.directoryScore[dirPath] = (group.directoryScore[dirPath] || 0) + 1;
            added = true;
            break;
          }
        }
        
        // 如果没有合适的组，创建新组
        if (!added) {
          fileGroups.push({
            files: [file],
            totalSize: fileSize,
            directoryScore: { [dirPath]: 1 }
          });
        }
      }
    }
  }
  
  // 优化批次：合并小批次
  fileGroups.sort((a, b) => a.totalSize - b.totalSize);
  for (let i = 0; i < fileGroups.length - 1; i++) {
    const current = fileGroups[i];
    
    // 如果当前组太小，尝试合并
    if (current.totalSize < maxBatchSize * 0.5) {
      for (let j = i + 1; j < fileGroups.length; j++) {
        const next = fileGroups[j];
        
        // 检查合并后是否超出大小限制
        if (current.totalSize + next.totalSize <= maxBatchSize) {
          // 合并组
          current.files.push(...next.files);
          current.totalSize += next.totalSize;
          
          // 合并目录评分
          for (const dir in next.directoryScore) {
            current.directoryScore[dir] = (current.directoryScore[dir] || 0) + next.directoryScore[dir];
          }
          
          // 移除已合并的组
          fileGroups.splice(j, 1);
          j--;
        }
      }
    }
  }
  
  // 提取最终批次
  const batches = fileGroups.map(group => group.files);
  
  logWithTime(`智能分批完成，创建了 ${batches.length} 个批次`);
  batches.forEach((batch, index) => {
    logWithTime(`批次 ${index + 1}: ${batch.length} 个文件，约 ${Math.floor(JSON.stringify(batch).length / 1024)} KB`);
  });
  
  return batches;
}

/**
 * 生成批次间的连续性提示
 */
function createBatchPrompt(
  batchNumber: number, 
  totalBatches: number, 
  context: BatchContext,
  isLastBatch: boolean
): string {
  if (batchNumber === 1) {
    // 第一个批次
    return `这是代码评估的第 1/${totalBatches} 批次。
请首先阅读并理解下面的代码文件内容，之后的批次中会提供更多文件。
请分析这些文件的结构、功能和实现方式，但暂时不要进行最终评估或打分。
请记住您看到的内容，稍后的批次将需要您利用这些信息。`;
  } else if (isLastBatch) {
    // 最后一个批次
    let previousFiles = '';
    if (context.processedFiles && context.processedFiles.length > 0) {
      previousFiles = `\n\n## 您在之前的批次中已分析过的文件：
${context.processedFiles.map(path => `- ${path}`).join('\n')}`;
    }
    
    let insights = '';
    if (context.keyInsights && context.keyInsights.length > 0) {
      insights = `\n\n## 您在之前批次中发现的主要代码特点：
${context.keyInsights.map((insight, i) => `${i+1}. ${insight}`).join('\n')}`;
    }
    
    return `## 这是代码评估的最后一个批次（${batchNumber}/${totalBatches}）

您现在需要完成两项任务：
1. 分析本批次中的代码文件
2. 综合所有批次（包括之前批次和当前批次）的所有文件，进行全面评估

请特别注意：您的评估必须基于所有已查看过的文件，而不仅仅是当前批次的文件。
您之前看过的文件同样重要，必须纳入最终评估。${previousFiles}${insights}

请在分析完本批次代码后，对照评估标准进行全面评估，提供详细报告和评分。`;
  } else {
    // 中间批次
    let previousFiles = '';
    if (context.processedFiles && context.processedFiles.length > 0) {
      previousFiles = `\n\n您之前批次已分析过的文件：
${context.processedFiles.map(path => `- ${path}`).join('\n')}`;
    }
    
    let insights = '';
    if (context.keyInsights && context.keyInsights.length > 0) {
      insights = `\n\n您之前批次发现的主要代码特点：
${context.keyInsights.map((insight, i) => `${i+1}. ${insight}`).join('\n')}`;
    }
    
    return `## 这是代码评估的第 ${batchNumber}/${totalBatches} 批次

请继续分析下面的代码文件，但暂时不要进行最终评估或打分。
您已经在之前批次分析了 ${context.processedFiles.length} 个文件，现在将继续分析更多文件。${previousFiles}${insights}

请记住您在本批次看到的内容，并与之前批次的分析进行关联。最后一个批次将要求您对所有文件进行综合评估。`;
  }
}

/**
 * 批量处理评估代码 - 将代码分成多个批次评估
 */
export async function evaluateCodeInBatches(params: CodeEvaluationParams): Promise<CodeEvaluationResult> {
  const startTime = Date.now();
  logWithTime('开始批处理代码评估');
  logWithTime(`项目: ${params.projectDetail.substring(0, 100)}...`);
  logWithTime(`总文件数: ${params.relevantFiles.length}`);
  
  // 模拟数据快速返回
  if (shouldUseMockData()) {
    logWithTime('配置为使用模拟数据，跳过批处理');
    return getMockEvaluationResult();
  }
  
  // 计算批次大小限制 - 每批约75k tokens (约300K字符)
  const MAX_BATCH_CHARS = 300000;
  
  // 创建批次
  const allFiles = [...params.relevantFiles];
  logWithTime(`准备分批，文件总数: ${allFiles.length}`);
  
  // 使用智能分批算法
  const batches = createSmartFileBatches(allFiles, MAX_BATCH_CHARS);
  
  // 如果只有一个批次，直接评估
  if (batches.length === 1) {
    logWithTime('只有一个批次，直接使用标准评估');
    return evaluateCode(params);
  }
  
  logWithTime(`文件已分为 ${batches.length} 批处理`);
  
  // 初始化上下文
  const context: BatchContext = {
    processedFiles: [],
    keyInsights: [],
    batchResults: []
  };
  
  let lastResult: CodeEvaluationResult | null = null;
  
  // 处理每个批次
  for (let i = 0; i < batches.length; i++) {
    const isLastBatch = i === batches.length - 1;
    const batch = batches[i];
    const batchNumber = i + 1;
    
    logWithTime(`处理批次 ${batchNumber}/${batches.length}, 包含 ${batch.length} 个文件`);
    
    try {
      // 为当前批次创建上下文提示
      const batchPrompt = createBatchPrompt(
        batchNumber, 
        batches.length, 
        context,
        isLastBatch
      );
      
      // 创建批次参数
      const batchParams: CodeEvaluationParams = {
        ...params,
        relevantFiles: batch,
        projectDetail: `${batchPrompt}\n\n${params.projectDetail}`
      };
      
      // 根据批次类型使用不同的系统提示
      if (!isLastBatch) {
        // 非最后批次：分析模式
        batchParams.currentTask = `[批次${batchNumber}/${batches.length}] ${params.currentTask} - 分析模式`;
      } else {
        // 最后批次：评估模式
        batchParams.currentTask = `[批次${batchNumber}/${batches.length}] ${params.currentTask} - 综合评估`;
      }
      
      // 修改system prompt以确保连贯性
      batchParams.repoSummary = isLastBatch
        ? `${params.repoSummary}\n\n[最终批次] 请基于所有批次文件进行综合评估。`
        : `${params.repoSummary}\n\n[批次 ${batchNumber}/${batches.length}] 请分析这些文件，记住内容，但不要最终评估。`;
      
      // 评估当前批次
      logWithTime(`开始评估批次 ${batchNumber}/${batches.length}`);
      const batchStartTime = Date.now();
      
      const batchResult = await evaluateCode(batchParams);
      
      const batchDuration = Date.now() - batchStartTime;
      logWithTime(`批次 ${batchNumber}/${batches.length} 评估完成，耗时 ${batchDuration}ms`);
      
      // 收集处理过的文件路径
      context.processedFiles.push(...batch.map(file => file.path));
      
      // 保存批次结果
      const batchEvalResult: BatchEvaluationResult = {
        batch: batchNumber,
        totalBatches: batches.length,
        result: batchResult,
        processedFiles: batch.map(file => file.path),
        success: true
      };
      
      context.batchResults.push(batchEvalResult);
      
      // 如果不是最后一个批次，尝试提取关键见解
      if (!isLastBatch && batchResult.rawContent) {
        try {
          // 尝试从结果中提取关键见解
          const rawContent = batchResult.rawContent;
          
          // 收集checkpoints或summary中的信息
          if (rawContent.checkpoints && Array.isArray(rawContent.checkpoints)) {
            const insights = rawContent.checkpoints
              .filter((cp: any) => cp.status && cp.details)
              .map((cp: any) => `${cp.requirement}: ${cp.status}`);
            
            if (insights.length > 0) {
              context.keyInsights.push(...insights.slice(0, 3));
            }
          }
          
          if (rawContent.summary && typeof rawContent.summary === 'string') {
            // 提取摘要中的关键点
            const summaryPoints = rawContent.summary
              .split(/[|,;.]/)
              .filter((point: string) => point.trim().length > 10)
              .slice(0, 2);
            
            if (summaryPoints.length > 0) {
              context.keyInsights.push(...summaryPoints);
            }
          }
          
          // 限制关键见解数量
          if (context.keyInsights.length > 5) {
            context.keyInsights = context.keyInsights.slice(0, 5);
          }
        } catch (error) {
          logError('提取批次见解失败', error);
          // 继续处理，这不是致命错误
        }
      }
      
      // 保存最后一个批次的结果
      lastResult = batchResult;
      
      // 如果是最后一个批次，进行额外的汇总步骤
      if (isLastBatch) {
        try {
          // 收集所有批次的分析结果
          const batchAnalyses = context.batchResults.map(br => {
            if (br.success && br.result.rawContent) {
              // 提取分析部分
              const content = br.result.rawContent;
              return {
                batch: br.batch,
                files: br.processedFiles,
                insights: content.checkpoints || [],
                summary: content.summary || ""
              };
            }
            return null;
          }).filter(Boolean);
          
          // 创建汇总请求
          if (batchAnalyses.length > 1) {
            logWithTime(`执行批次汇总分析...`);
            
            // 构建汇总提示
            const summaryPrompt = `请根据以下所有批次的代码分析结果，进行最终的综合评估。这是对所有批次（共${batches.length}批）分析的汇总。
            
您已经分析了以下所有文件：
${context.processedFiles.map(path => `- ${path}`).join('\n')}

每个批次的分析摘要：
${batchAnalyses.map(ba => {
  if (!ba) return ''; // 处理可能为null的情况
  return `
--- 批次 ${ba.batch} 分析 ---
文件: ${ba.files.join(', ')}
${ba.summary ? `摘要: ${ba.summary}` : ''}
`;
}).join('\n')}

请基于所有这些信息，对照评估标准进行最终综合评估。
您的评估必须考虑所有批次的所有文件，而不仅是最后一批。`;
            
            // 创建汇总请求参数
            const summaryParams: CodeEvaluationParams = {
              ...params,
              projectDetail: params.projectDetail + "\n\n" + summaryPrompt,
              relevantFiles: [], // 不包含代码文件，只包含分析
              currentTask: `最终综合评估 - 基于${context.processedFiles.length}个文件的分析`,
              repoSummary: `${params.repoSummary}\n\n[综合评估] 基于所有${batches.length}批次的分析进行最终评估。`
            };
            
            // 执行汇总评估
            const summaryStartTime = Date.now();
            const summaryResult = await evaluateCode(summaryParams);
            const summaryDuration = Date.now() - summaryStartTime;
            logWithTime(`汇总分析完成，耗时 ${summaryDuration}ms`);
            
            // 使用汇总结果替代最后批次结果
            lastResult = summaryResult;
            
            // 返回汇总结果
            const totalDuration = Date.now() - startTime;
            logWithTime(`批处理评估完成（含汇总），总耗时 ${totalDuration}ms`);
            return summaryResult;
          }
        } catch (summaryError) {
          logError('执行汇总分析失败，将使用最后批次结果', summaryError);
          // 继续使用最后批次结果
        }
        
        const totalDuration = Date.now() - startTime;
        logWithTime(`批处理评估完成，总耗时 ${totalDuration}ms`);
        return batchResult;
      }
      
      // 批次间短暂暂停，避免频繁API调用
      if (i < batches.length - 1) {
        logWithTime(`批次间冷却，等待1秒...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logError(`批次 ${batchNumber}/${batches.length} 处理失败`, error);
      
      // 记录失败的批次
      context.batchResults.push({
        batch: batchNumber,
        totalBatches: batches.length,
        result: { rawContent: null },
        processedFiles: batch.map(file => file.path),
        success: false,
        error: error as Error
      });
      
      // 如果是最后一个批次出错，抛出异常
      if (isLastBatch) {
        throw error;
      }
      
      // 否则继续处理下一个批次
      logWithTime(`尽管批次 ${batchNumber} 失败，但继续处理后续批次`);
      continue;
    }
  }
  
  // 如果没有任何批次成功，抛出异常
  if (!lastResult) {
    throw new Error('所有批次处理都失败了');
  }
  
  // 返回最后一个批次的结果
  return lastResult;
}

/**
 * 创建视频评估提示
 */
function createVideoEvaluationPrompt(
  youtubeLink: string,
  projectDetail: string,
  tasks: string[],
  codeEvaluation: CodeEvaluationResult
): string {
  return `请评估以下YouTube视频演示与GitHub代码仓库的契合度：

【项目信息】
${projectDetail}

【项目任务】
${tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}

【代码评估结果】
代码完成度评分: ${codeEvaluation.rawContent?.assessment || 'N/A'}
代码分析摘要: ${codeEvaluation.rawContent?.summary || 'N/A'}
关键检查点:
${codeEvaluation.rawContent?.checkpoints?.map((cp: any) => `- ${cp.requirement}: ${cp.status}`).join('\n') || 'N/A'}

【评估任务】
1. 观看视频演示 (${youtubeLink})
2. 分析视频内容与代码实现的一致性
3. 评估演讲者对项目的理解和表达能力
4. 评估视频演示是否覆盖了代码中实现的主要功能

请提供以下JSON格式的评估结果：
{
  "presentationScore": 0.xx, // 演示质量评分(0-1之间)
  "summary": "视频内容摘要...",
  "codeVideoAlignment": [
    {"aspect": "功能A", "aligned": true/false, "details": "详细说明..."},
    {"aspect": "功能B", "aligned": true/false, "details": "详细说明..."}
    // 至少分析5个主要方面
  ],
  "overallFeedback": "综合评价和建议..."
}`;
}

/**
 * 评估视频演示
 */
export async function evaluateVideoPresentation(
  youtubeLink: string,
  projectDetail: string,
  tasks: string[],
  codeEvaluationResult: CodeEvaluationResult
): Promise<VideoEvaluationResult> {
  logWithTime('开始视频演示评估');
  logWithTime(`YouTube链接: ${youtubeLink}`);
  
  try {
    // 创建评估提示
    const evaluationPrompt = createVideoEvaluationPrompt(
      youtubeLink,
      projectDetail,
      tasks,
      codeEvaluationResult
    );
    
    // 调用Gemini API评估视频
    const responseText = await evaluateYouTubeVideo(youtubeLink, evaluationPrompt);
    
    // 解析响应结果
    const parsedResult = extractJsonFromMarkdownGemini(responseText);
    
    if (!parsedResult) {
      throw new Error('无法解析视频评估结果');
    }
    
    logWithTime('视频评估完成');
    
    return {
      videoRawContent: {
        presentationScore: parsedResult.presentationScore || 0,
        summary: parsedResult.summary || '',
        codeVideoAlignment: parsedResult.codeVideoAlignment || [],
        overallFeedback: parsedResult.overallFeedback || ''
      }
    };
  } catch (error) {
    logError('视频评估失败', error);
    throw new Error(`视频评估失败: ${(error as Error).message}`);
  }
}