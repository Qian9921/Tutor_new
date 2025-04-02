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
            content: `You are a code assessment expert. Please evaluate the completion level of a GitHub repository code based on the following information:

【Assessment Steps】
1. Carefully read all information: project details (projectDetail), task list (tasks), current task (currentTask), and completion criteria (evidence)
2. Focus on reviewing the provided code files (\`relevant_files\`). **Crucially, if the \`relevant_files\` list is empty, you MUST conclude that the required files do not exist and evaluate the corresponding criteria in \`evidence\` as 'Not completed', regardless of what the task description or evidence implies.** Only evaluate files present in the \`relevant_files\` list.
3. Compare each checkpoint in evidence and evaluate the code implementation status based *only* on the files in \`relevant_files\`.
4. Calculate a completion score between 0-1 based on your evaluation of the provided files against the evidence.
5. Provide analysis and improvement suggestions based on the provided files.
6. Use appropriate emojis generously in suitable places to enhance readability, attract user attention, and make the content lively.
7. Include at least 10 emojis in your response while maintaining valid JSON format.
8. Don't use emojis randomly - place them appropriately and use a variety of types.

【Scoring Criteria】
- 1.0: 100% of requirements in evidence are fully met *within the provided files*.
- 0.9: 95-99% of requirements met, with only minor issues *within the provided files*.
- 0.8: 85-94% of requirements met, with some minor issues *within the provided files*.
- 0.7: 75-84% of requirements met, with several notable issues *within the provided files*.
- 0.6: 65-74% of requirements met, with significant deficiencies *within the provided files*.
- 0.5: 55-64% of requirements met, basically usable *within the provided files*.
- 0.4: 45-54% of requirements met, partially functional *within the provided files*.
- 0.3: 35-44% of requirements met, most features have issues *within the provided files*.
- 0.2: 25-34% of requirements met, majority have issues *within the provided files*.
- 0.1: 10-24% of requirements met, almost all have issues *within the provided files*.
- 0.0: Less than 10% of requirements met, *or the \`relevant_files\` list is empty and evidence requires specific files*.

【Output Format】
Please provide the assessment result in JSON format:
{
  "assessment": 0.xx, // Completion score (decimal between 0-1, two decimal places) based strictly on provided files vs evidence.
  "checkpoints": [
    {"requirement": "Checkpoint 1", "status": "Completed", "details": "Implementation analysis based on provided files..."},
    {"requirement": "Checkpoint 2", "status": "Not completed", "details": "Reason for incompletion (e.g., file missing from relevant_files, requirement not met in provided file)..."},
    {"requirement": "Checkpoint 3", "status": "Partially completed", "details": "Problem analysis based on provided files..."}
  ], // Checkpoints must include all checkpoints from evidence, evaluated against relevant_files.
  "summary": "Overall code assessment based on provided files, including at least 6 key points",
  "improvements": [
    "Improvement 1: Please explain in detail how to implement feature X, including files to modify (or create if missing) and specific code examples",
    "Improvement 2: Please explain in three steps how to solve problem Y based on the provided code (or suggest implementation if missing), and provide complete implementation ideas"
  ] // More detailed improvement suggestions are better, relate them to the provided files or note if files are missing.
}

Note:
- Evidence is the core standard for assessment, must strictly evaluate according to each checkpoint *against the provided relevant_files*.
- **CRITICAL:** Base your assessment *strictly* on the files provided in the \`relevant_files\` list. If this list is empty (\`[]\`), any requirements in \`evidence\` that depend on specific files MUST be marked as 'Not completed', and the overall assessment score should reflect this (likely 0.0 if files are essential).
- Improvement suggestions must be specific, actionable, and contain clear operational instructions related to the provided code or missing elements.
- All analysis must be based *only* on the provided code files (\`relevant_files\`) and project context. Do not assume files exist if they are not in the list.
- Scoring must be objective and consistent with checkpoint completion status based on \`relevant_files\`.
- Assessment result must include at least 10 emojis.
- Assessment result must use JSON format.
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
        {requirement: "User login functionality", status: "✅ Completed", details: "Login functionality works correctly"},
        {requirement: "Password reset functionality", status: "❌ Not completed", details: "Missing password reset process"},
        {requirement: "Security protection mechanisms", status: "⚠️ Partially completed", details: "Missing CAPTCHA protection against brute force attacks"}
      ],
      summary: "✅Complete login process | ✅User-friendly UI | ❌Missing password reset | ❌No remembered login state | ⚠️No CAPTCHA for brute force protection | ⚠️Insufficient password strength detection",
      improvements: [
        "Improvement 1: Please explain in detail how to implement SMS verification code login functionality, including files to modify and specific code examples",
        "Improvement 2: Please explain in three steps how to add password reset functionality, and provide complete implementation ideas and code examples",
        "Improvement 3: Please provide 5 approaches to prevent brute force login attacks"
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
    // First batch
    return `This is batch 1/${totalBatches} of the code assessment.
Please first read and understand the content of the code files below. More files will be provided in later batches.
Analyze the structure, functionality, and implementation of these files, but do not perform final evaluation or scoring yet.
Remember what you see, as later batches will require you to use this information.`;
  } else if (isLastBatch) {
    // Last batch
    let previousFiles = '';
    if (context.processedFiles && context.processedFiles.length > 0) {
      previousFiles = `\n\n## Files you have analyzed in previous batches:
${context.processedFiles.map(path => `- ${path}`).join('\n')}`;
    }
    
    let insights = '';
    if (context.keyInsights && context.keyInsights.length > 0) {
      insights = `\n\n## Key code characteristics you discovered in previous batches:
${context.keyInsights.map((insight, i) => `${i+1}. ${insight}`).join('\n')}`;
    }
    
    return `## This is the final batch of code assessment (${batchNumber}/${totalBatches})

You now need to complete two tasks:
1. Analyze the code files in this batch
2. Perform a comprehensive evaluation incorporating all files from all batches (previous and current)

Please note: Your assessment must be based on all the files you have reviewed, not just the files in the current batch.
Files you have seen previously are equally important and must be included in your final assessment.${previousFiles}${insights}

After analyzing the code in this batch, please conduct a thorough evaluation against the assessment criteria, providing a detailed report and score.`;
  } else {
    // Middle batch
    let previousFiles = '';
    if (context.processedFiles && context.processedFiles.length > 0) {
      previousFiles = `\n\nFiles you have analyzed in previous batches:
${context.processedFiles.map(path => `- ${path}`).join('\n')}`;
    }
    
    let insights = '';
    if (context.keyInsights && context.keyInsights.length > 0) {
      insights = `\n\nKey code characteristics you discovered in previous batches:
${context.keyInsights.map((insight, i) => `${i+1}. ${insight}`).join('\n')}`;
    }
    
    return `## This is batch ${batchNumber}/${totalBatches} of the code assessment

Please continue analyzing the code files below, but do not perform final evaluation or scoring yet.
You have already analyzed ${context.processedFiles.length} files in previous batches and will now analyze more files.${previousFiles}${insights}

Remember what you see in this batch and relate it to your previous batch analyses. The final batch will ask you to evaluate all files comprehensively.`;
  }
}

/**
 * 批量处理评估代码 - 将代码分成多个批次评估
 */
export async function evaluateCodeInBatches(params: CodeEvaluationParams): Promise<CodeEvaluationResult> {
  const startTime = Date.now();
  logWithTime('Starting batch code evaluation');
  logWithTime(`Project: ${params.projectDetail.substring(0, 100)}...`);
  logWithTime(`Total files: ${params.relevantFiles.length}`);
  
  // 模拟数据快速返回
  if (shouldUseMockData()) {
    logWithTime('Configured to use mock data, skipping batch processing');
    return getMockEvaluationResult();
  }
  
  // 计算批次大小限制 - 每批约75k tokens (约300K字符)
  const MAX_BATCH_CHARS = 300000;
  
  // 创建批次
  const allFiles = [...params.relevantFiles];
  logWithTime(`Preparing batches, total files: ${allFiles.length}`);
  
  // 使用智能分批算法
  const batches = createSmartFileBatches(allFiles, MAX_BATCH_CHARS);
  
  // 如果只有一个批次，直接评估
  if (batches.length === 1) {
    logWithTime('Only one batch, using standard evaluation');
    return evaluateCode(params);
  }
  
  logWithTime(`Files divided into ${batches.length} batches`);
  
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
    
    logWithTime(`Processing batch ${batchNumber}/${batches.length}, containing ${batch.length} files`);
    
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
        // Non-final batch: analysis mode
        batchParams.currentTask = `[Batch ${batchNumber}/${batches.length}] ${params.currentTask} - Analysis mode`;
      } else {
        // Final batch: evaluation mode
        batchParams.currentTask = `[Batch ${batchNumber}/${batches.length}] ${params.currentTask} - Comprehensive evaluation`;
      }
      
      // Modify system prompt to ensure continuity
      batchParams.repoSummary = isLastBatch
        ? `${params.repoSummary}\n\n[Final batch] Please provide a comprehensive evaluation based on all batch files.`
        : `${params.repoSummary}\n\n[Batch ${batchNumber}/${batches.length}] Please analyze these files, remember the content, but do not provide final evaluation.`;
      
      // 评估当前批次
      logWithTime(`Starting evaluation of batch ${batchNumber}/${batches.length}`);
      const batchStartTime = Date.now();
      
      const batchResult = await evaluateCode(batchParams);
      
      const batchDuration = Date.now() - batchStartTime;
      logWithTime(`Batch ${batchNumber}/${batches.length} evaluation completed, took ${batchDuration}ms`);
      
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
          logError('Failed to extract batch insights', error);
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
            logWithTime(`Performing batch summary analysis...`);
            
            // 构建汇总提示
            const summaryPrompt = `Please provide a comprehensive evaluation based on all batch code analysis results. This is a summary of analysis across all batches (total ${batches.length} batches).
            
You have analyzed the following files:
${context.processedFiles.map(path => `- ${path}`).join('\n')}

Each batch analysis summary:
${batchAnalyses.map(ba => {
  if (!ba) return ''; // 处理可能为null的情况
  return `
--- Batch ${ba.batch} Analysis ---
Files: ${ba.files.join(', ')}
${ba.summary ? `Summary: ${ba.summary}` : ''}
`;
}).join('\n')}

Please conduct a thorough evaluation based on all these information, against the assessment criteria.
Your assessment must consider all files from all batches, not just the last batch.`;
            
            // 创建汇总请求参数
            const summaryParams: CodeEvaluationParams = {
              ...params,
              projectDetail: params.projectDetail + "\n\n" + summaryPrompt,
              relevantFiles: [], // 不包含代码文件，只包含分析
              currentTask: `Final comprehensive evaluation - Analysis based on ${context.processedFiles.length} files`,
              repoSummary: `${params.repoSummary}\n\n[Comprehensive evaluation] Based on analysis across all ${batches.length} batches for final assessment.`
            };
            
            // 执行汇总评估
            const summaryStartTime = Date.now();
            const summaryResult = await evaluateCode(summaryParams);
            const summaryDuration = Date.now() - summaryStartTime;
            logWithTime(`Summary analysis completed, took ${summaryDuration}ms`);
            
            // 使用汇总结果替代最后批次结果
            lastResult = summaryResult;
            
            // 返回汇总结果
            const totalDuration = Date.now() - startTime;
            logWithTime(`Batch processing evaluation completed (including summary), total took ${totalDuration}ms`);
            return summaryResult;
          }
        } catch (summaryError) {
          logError('执行汇总分析失败，将使用最后批次结果', summaryError);
          // 继续使用最后批次结果
        }
        
        const totalDuration = Date.now() - startTime;
        logWithTime(`Batch processing evaluation completed, total took ${totalDuration}ms`);
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
  // Safely access nested properties of codeEvaluation.rawContent
  const assessmentScore = codeEvaluation.rawContent?.assessment ?? 'N/A';
  const codeSummary = codeEvaluation.rawContent?.summary ?? 'N/A';
  let codeCheckpoints = 'N/A';
  if (codeEvaluation.rawContent?.checkpoints && Array.isArray(codeEvaluation.rawContent.checkpoints)) {
    codeCheckpoints = codeEvaluation.rawContent.checkpoints
      .map((cp: any) => `- ${cp.requirement || 'Unknown requirement'}: ${cp.status || 'Unknown status'}`)
      .join('\n');
  }

  return `You are an expert evaluator assessing the alignment between a YouTube video demonstration and a corresponding code project assessment.

【Context】
1.  **Project Details:** ${projectDetail}
2.  **Project Tasks:**
${tasks.map((task, index) => `    - Task ${index + 1}: ${task}`).join('\n')}
3.  **Code Assessment Results (Summary):**
    - Code Completion Score: ${assessmentScore}
    - Code Analysis Summary: ${codeSummary}
    - Key Code Checkpoints Status:
${codeCheckpoints.split('\n').map(line => `      ${line}`).join('\n')}
4.  **Video for Review:** ${youtubeLink}

【Assessment Steps】
1.  **Watch the Video:** Carefully watch the entire video demonstration at the provided YouTube link.
2.  **Review Code Assessment:** Re-familiarize yourself with the provided 'Code Assessment Results', paying close attention to the completion status of different requirements.
3.  **Evaluate Accuracy & Clarity:** Assess how accurately the video demonstrates the project features described in 'Project Details' and 'Project Tasks'. Evaluate the clarity and completeness of the presenter's explanation and demonstration.
4.  **Evaluate Alignment:** Critically evaluate the alignment between the video content and the 'Code Assessment Results'. Does the video accurately reflect the status (Completed, Partially completed, Not completed) of the features as assessed in the code? Does it demonstrate completed features well? Does it acknowledge or misrepresent incomplete aspects?
5.  **Score the Presentation:** Assign a 'presentationScore' based on the scoring criteria below.
6.  **Provide Detailed Feedback:** Generate the assessment result in the specified JSON format, providing specific examples from the video to justify your findings.

【Scoring Criteria for Video Presentation】
Score reflects clarity, accuracy, completeness, presenter's knowledge, and alignment with the provided code assessment status.
- **1.0:** Excellent. Clear, comprehensive, highly accurate demonstration that perfectly aligns with the code assessment status. Presenter is knowledgeable and communicates effectively.
- **0.8:** Good. Mostly clear and accurate. Minor omissions or slight misalignments with code status (e.g., glossing over a partially complete feature). Good communication.
- **0.6:** Fair. Some clarity issues or significant omissions. Moderate misalignment with code status (e.g., demonstrating a feature marked as 'Not completed' without acknowledgment, or poor demonstration of completed features). Communication could be better.
- **0.4:** Poor. Unclear, incomplete presentation with major inaccuracies or misrepresentation of the code's status. Presenter seems unfamiliar with the project.
- **0.2:** Very Poor. Video is largely irrelevant, fails to demonstrate the project meaningfully, or contains severe misrepresentations.
- **0.0:** Cannot Evaluate. Video is unavailable, completely unrelated, or provides no basis for assessment.

【Output Format】
Please provide the evaluation results strictly in the following JSON format:
{
  "presentationScore": 0.xx, // Float between 0.0 and 1.0 based on the scoring criteria.
  "scoreJustification": "Detailed explanation justifying the presentationScore, citing specific examples from the video and referencing alignment with code assessment status.",
  "videoSummary": "Concise summary of the key points covered in the video demonstration.",
  "alignmentAnalysis": [
    // Add objects for key aspects, comparing video to code assessment.
    // Example 1: Feature mentioned in tasks/code assessment.
    // Example 2: Representation of overall completion.
    {
      "aspect": "Demonstration of [Specific Feature/Task Requirement]",
      "status": "Aligned / Partially Aligned / Misaligned / Not Covered", // Choose one
      "details": "Explanation of how the video aligns or misaligns with the code assessment for this aspect. Mention specific timestamps or observations from the video."
    },
    // Add more alignment checkpoints as needed...
    {
      "aspect": "Overall Representation of Project Status",
      "status": "Accurate / Mostly Accurate / Misleading", // Choose one
      "details": "Does the video give an overall impression consistent with the code assessment score and summary? Explain."
    }
  ],
  "suggestionsForImprovement": [
    // Provide specific, actionable suggestions for improving the video presentation.
    // Focus on clarity, accuracy, completeness, and better alignment with code reality.
    "Suggestion 1: Clearly state the completion status of Feature X based on the code assessment when demonstrating it.",
    "Suggestion 2: Include a demonstration of [Missing Feature Y mentioned in code assessment] or explicitly state it's not yet implemented.",
    "Suggestion 3: [Specific suggestion regarding presentation clarity or structure]"
    // Add more suggestions...
  ],
  "overallFeedback": "Concluding remarks on the video presentation quality and its alignment with the project's assessed state."
}

Note:
- Base your evaluation *strictly* on comparing the video content against the provided 'Code Assessment Results'.
- Justify all points in 'alignmentAnalysis' and 'scoreJustification' with specific observations from the video.
- Ensure the output is valid JSON.
`;
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
    
    if (parsedResult) {
      // 解析成功
      logWithTime('视频评估完成');
      
      return {
        videoRawContent: {
          presentationScore: parsedResult.presentationScore || 0,
          scoreExplanation: parsedResult.scoreExplanation || '',
          summary: parsedResult.summary || '',
          codeVideoAlignment: parsedResult.codeVideoAlignment || [],
          improvements: parsedResult.improvements || [],
          overallFeedback: parsedResult.overallFeedback || ''
        }
      };
    } else {
      // 解析失败，但仍返回一致的结构
      logWithTime('无法解析视频评估结果为JSON，将构造兼容结构');
      
      // 提取响应文本的前500个字符作为摘要
      const shortSummary = responseText.length > 500 
        ? responseText.substring(0, 500) + '...(content truncated)' 
        : responseText;
      
      return {
        videoRawContent: {
          presentationScore: 0.5, // Default medium score
          scoreExplanation: 'Original response is not in valid JSON format, converted to object',
          summary: '[Parsing failed] Original response:\n' + shortSummary,
          codeVideoAlignment: [
            {
              aspect: "Parsing status",
              aligned: false,
              details: "Unable to parse API response as JSON format. Please check the summary field for original response content."
            }
          ],
          improvements: [],
          overallFeedback: "⚠️ Video evaluation result parsing failed. System has returned default structure, but content may not be accurate. Please contact administrator to check API response format.",
          // Keep original text for reference
          _originalText: responseText,
          _isJsonFormat: false
        }
      };
    }
  } catch (error) {
    logError('视频评估失败', error);
    throw new Error(`Video evaluation failed: ${(error as Error).message}`);
  }
}