import { VertexAI } from '@google-cloud/vertexai';
import { evaluateYouTubeVideo, extractJsonFromMarkdown as extractJsonFromMarkdownGemini } from './gemini';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [VERTEX AI] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [VERTEX AI] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [VERTEX AI ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 项目配置
const projectId = 'open-impact-lab-zob4aq';
const location = 'us-central1';
const modelName = 'gemini-2.5-pro';

// 创建VertexAI客户端
function createVertexAIClient() {
  try {
    // 初始化Vertex AI
    const vertexAI = new VertexAI({
      project: projectId, 
      location: location
    });
    
    // 获取生成式模型
    return vertexAI.getGenerativeModel({
      model: modelName,
    });
  } catch (error) {
    logError('初始化VertexAI客户端失败', error);
    throw new Error(`初始化VertexAI客户端失败: ${(error as Error).message}`);
  }
}

// 初始化默认客户端
let generativeModel = createVertexAIClient();

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
  //   scoreExplanation: string; // 评分解释
  //   summary: string; // 视频内容总结和反馈
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
    //const MAX_FILE_SIZE = 15000;    // 单个文件最大长度

    // 优先保留相关性高的文件
    const sortedFiles = [...files].sort((a, b) => b.relevance - a.relevance);

    // 截断内容的辅助函数
    const truncateContent = (content: string): string => {
      // 不再截断内容，直接返回原始内容
      return content;
    };

    // 先截断单个文件
    const processedFiles = sortedFiles.map(file => ({
      path: file.path,
      content: truncateContent(file.content),
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
      // 如果是重试，尝试重新初始化客户端
      if (retryCount > 0) {
        logWithTime(`重新初始化VertexAI客户端 (尝试 ${retryCount + 1}/${maxRetries})`);
        generativeModel = createVertexAIClient();
      }

      logWithTime(`发送评估请求到Vertex AI${retryCount > 0 ? ` (尝试 ${retryCount + 1}/${maxRetries})` : ''}`);

      // 打印请求数据
      logWithTime('请求数据', requestData);

      // 构建系统提示和用户提示
      const systemPrompt = `You are a code assessment expert. Your job is to evaluate ONLY the CURRENT TASK based STRICTLY on the EVIDENCE criteria.

【IMPORTANT RULES】
1. Evaluate ONLY the currentTask, NOT other tasks from the tasks list
2. Use ONLY the evidence criteria for the currentTask as your evaluation standard
3. Give a score of 1.0 (full score) when ALL evidence criteria are satisfied
4. Do NOT invent additional requirements beyond what is stated in evidence

【Context Information】
- Project Details (projectDetail): Overall project description
- Tasks List (tasks): ALL tasks for the project (IGNORE other tasks except currentTask)
- Current Task (currentTask): The SPECIFIC task you must evaluate now
- Evidence (evidence): The EXACT criteria to evaluate currentTask against
- GitHub Repo URL (githubRepoUrl): The repository URL
- Repository Summary (repoSummary): Brief repository description
- Relevant Files (relevant_files): Code files related to currentTask (may be empty)

【Assessment Process】
1. Identify each criterion in the evidence
2. Classify each criterion into one of these types:
   a. Repository Existence: Check if githubRepoUrl exists (ALWAYS true if provided)
   b. File Existence: Check if a required file exists in relevant_files list
   c. File Content: Check if a file in relevant_files contains specific content
   d. URL Format: Check if githubRepoUrl follows a specific format
   e. Other: Any other type of criterion

3. Evaluate each criterion appropriately based on its type:
   - For Repository Existence: Mark as "Completed" if githubRepoUrl is provided
   - For File Existence: Mark as "Completed" if the file exists in relevant_files
   - For File Content: Mark as "Completed" if the file exists AND contains required content
   - For URL Format: Evaluate the githubRepoUrl directly
   - For Other: Evaluate based on available information

4. Assign a status to each criterion:
   - "Completed" - The criterion is fully satisfied
   - "Partially completed" - The criterion is partially satisfied
   - "Not completed" - The criterion is not satisfied

5. Calculate the final score:
   - 1.0: ALL criteria in evidence are "Completed"
   - 0.8: Most criteria are "Completed" with only minor issues
   - 0.5: Roughly half of the criteria are "Completed"
   - 0.2: Most criteria are "Not completed"
   - 0.0: No criteria are "Completed"

【Output Format】
Provide assessment in JSON format:
{
  "assessment": 0.xx, // Score from 0.0-1.0, give 1.0 if ALL evidence criteria are fully met
  "checkpoints": [
    {"requirement": "Evidence item 1", "status": "Completed/Partially completed/Not completed", "details": "Explanation of evaluation..."},
    {"requirement": "Evidence item 2", "status": "...", "details": "..."}
  ],
  "summary": "Overall assessment focused only on evidence criteria fulfillment",
  "improvements": [
    "Improvement 1: Specific suggestion to meet unfulfilled evidence criteria...",
    "Improvement 2: Another suggestion..."
  ]
}

【Special Notes】
- If evidence mentions "Repository exists" or "GitHub URL is valid", mark it "Completed" if githubRepoUrl is provided
- If evidence requires checking a file's existence or content but relevant_files is empty, mark it "Not completed"
- CRITICAL: Score 1.0 means ALL evidence criteria are met, nothing more, nothing less
- Include at least 10 appropriate emojis in your response
- Format the response as valid JSON
`;

      // 使用VertexAI发送请求
      const request = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: JSON.stringify(requestData) }
            ],
          }
        ],
        generationConfig: {
          temperature: 0,
        },
      };

      // 发送请求并等待响应
      const response = await generativeModel.generateContent(request);
      const aggregatedResponse = await response.response;

      logWithTime('评估请求成功');

      // 检查响应是否包含有效内容
      if (!aggregatedResponse.candidates || 
          aggregatedResponse.candidates.length === 0 || 
          !aggregatedResponse.candidates[0].content ||
          !aggregatedResponse.candidates[0].content.parts ||
          aggregatedResponse.candidates[0].content.parts.length === 0) {
        throw new Error('收到的响应不包含有效内容');
      }

      // 获取响应文本并处理可能的undefined
      const firstPart = aggregatedResponse.candidates[0].content.parts[0];
      const responseContent = firstPart.text || '';
      
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
        errorMessage = `DNS解析失败，无法连接到API服务器: ${(error as Error).message}`;
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
        { requirement: "User login functionality", status: "✅ Completed", details: "Login functionality works correctly" },
        { requirement: "Password reset functionality", status: "❌ Not completed", details: "Missing password reset process" },
        { requirement: "Security protection mechanisms", status: "⚠️ Partially completed", details: "Missing CAPTCHA protection against brute force attacks" }
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
${context.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}`;
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
${context.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}`;
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
  projectDetail: string,
  tasks: string[],
  youtubeLink: string
): string {
  return `Please conduct a comprehensive, multi-dimensional assessment of the following YouTube video presentation.

【Project Information】
${projectDetail}

【Project Tasks】
${tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}

**【CORE INSTRUCTIONS - MUST READ】**
1.  **Adhere to Facts**: Your assessment **MUST** be based on the content **ACTUALLY** presented in the video. **Strictly prohibit** making assumptions about the video content based on the project information.
2.  **Content Verification**: First, determine if the video content is relevant to the 【Project Information】 and 【Project Tasks】 provided above.
3.  **Discrepancy Report**: If the video content is **completely unrelated** to the project, you MUST explicitly state this at the beginning of the assessment and describe the **actual** content of the video.
4.  **Duration First**: Before starting the assessment, determine and record the **exact duration** of the video (MM:SS format).

【Evaluation Task】
Please watch and analyze the video (${youtubeLink}), focusing on evaluating the following aspects:

**1. Content Relevance & Accuracy (Highest Priority)**
   *   **Relevance**: How well does the video content match the project description? (Fully Relevant / Partially Relevant / Completely Unrelated)
   *   **Authenticity**: Does the video genuinely showcase the work for this project, or does it display something else?
   *   **If Unrelated**: You must detail here what the video actually shows.

**2. Core Message Delivery**
   *   **Objective Clarity**: Are the project objectives and core concepts clearly articulated?
   *   **Content Depth**: Does the presenter demonstrate a deep understanding of the project? Is the information sufficient?
   *   **Logic & Structure**: Is the content organized logically? Are transitions smooth?

**3. Presentation Effectiveness & Technique**
   *   **Expression Clarity**: Is the language concise, fluent, and easy to understand?
   *   **Presentation Demeanor**: Is the presenter confident? Is the pacing and body language appropriate?
   *   **Visual Aids**: Are slides or other visual materials clear, effective, and consistently designed?

**4. Technical Quality & Duration**
   *   **Audio/Video Quality**: Is the audio clear? Is the video stable with adequate resolution?
   *   **Time Management**: Is the presentation completed within a reasonable timeframe? (Note: Check if it meets the 3-minute requirement).

**5. Innovation & Highlights (If content is relevant)**
   *   **Innovation Emphasis**: Are the project's innovations highlighted?
   *   **Uniqueness**: Does it demonstrate distinctiveness compared to similar projects?

【Scoring Guide】
*   **Baseline**: Scoring is based on the quality of the **actual content** presented in the video.
*   **Handling Irrelevance**: If the video content is **completely unrelated** to the project, then:
    *   \`presentationScore\` should primarily reflect the presentation effectiveness and technical quality of the **actual video content** (mainly based on dimensions 3 and 4), but the total score **should not exceed 0.5**.
    *   \`scoreExplanation\` and \`summary\` **must first** state that the video is unrelated to the project and explain that the score is based on the video's own quality.
*   **Score Ranges**:
    *   0.75-1.00: Excellent - Professional quality with clear presentation and comprehensive content.
    *   0.50-0.74: Proficient - Generally effective with some areas for improvement.
    *   0.25-0.49: Adequate - Meets basic requirements but needs significant enhancement.
    *   0.00-0.24: Insufficient - Fails to meet baseline standards, or the video is completely unrelated to the project (scored according to the rules above).

【Output Format - MUST ADHERE】
Please provide the assessment results strictly in the following JSON format:
{
  "videoDuration": "MM:SS", // The exact duration of the video, must be right!!!
  "presentationScore": 0.xx, // Overall score (0-1 range) based on ACTUAL video content
  "scoreExplanation": "Detailed rationale for the score. Must first state if the video is relevant to the project. If unrelated, explain the score is based on the video's own quality...",
  "summary": "Summary. Must first state if the video is relevant to the project. Then provide an overview based on the actual video content..."
}

**【Important Reminder】**
Your integrity is crucial. Please ensure your assessment is based on the **true** content of the video, even if it differs from the expected project description.`;
}

/**
 * 评估视频演示
 */
export async function evaluateVideoPresentation(
  youtubeLink: string,
  projectDetail: string,
  tasks: string[],
): Promise<VideoEvaluationResult> {
  logWithTime('开始视频演示评估');
  logWithTime(`YouTube链接: ${youtubeLink}`);
  
  try {
    // 创建评估提示
    const evaluationPrompt = createVideoEvaluationPrompt(
      projectDetail,
      tasks,
      youtubeLink
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
          videoDuration: parsedResult.videoDuration || '',
          presentationScore: parsedResult.presentationScore || 0,
          scoreExplanation: parsedResult.scoreExplanation || '',
          summary: parsedResult.summary || ''
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
          videoDuration: '',
          presentationScore: 0.5, // Default medium score
          scoreExplanation: 'Original response is not in valid JSON format, converted to object',
          summary: '[Parsing failed] Original response:\n' + shortSummary,
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