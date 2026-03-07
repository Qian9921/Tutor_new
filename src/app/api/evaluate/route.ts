import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { processGitHubRepository } from '@/lib/llamaindex';
import { evaluateCodeInBatches } from '@/lib/doubao';
import { v4 as uuidv4 } from 'uuid';

// 添加日志记录函数
function logWithTime(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [EVALUATE-API]`, ...args);
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [EVALUATE-API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 验证请求API密钥的中间件

/**
 * 评估API处理POST请求
 */
export async function POST(request: NextRequest) {
  logWithTime('POST /api/evaluate - 开始处理代码评估请求');
  
  try {
    // 确保数据库已初始化
    logWithTime('确保数据库已初始化...');
    try {
      await waitForDatabaseInitialization();
      logWithTime('数据库初始化完成');
    } catch (dbInitError) {
      logError('数据库初始化失败', dbInitError as Error);
      return NextResponse.json(
        { success: false, message: '数据库初始化失败', error: (dbInitError as Error).message },
        { status: 500 }
      );
    }
    
    // 测试数据库连接
    logWithTime('测试数据库连接状态...');
    try {
      const testDocRef = db.collection(COLLECTIONS.SYSTEM_LOGS).doc(`connection-test-${Date.now()}`);
      await testDocRef.set({
        message: 'Database connection test from evaluate API',
        data: { timestamp: new Date() }
      });
      logWithTime('✅ 数据库连接测试成功');
    } catch (dbError) {
      logError('❌ 数据库连接测试失败', dbError as Error);
      return NextResponse.json(
        { success: false, message: 'Database connection failed', error: (dbError as Error).message },
        { status: 500 }
      );
    }
    
    // 解析请求数据
    logWithTime('解析请求JSON数据');
    let requestData;
    try {
      requestData = await request.json();
      logWithTime('请求数据:', requestData);
    } catch (parseError) {
      logError('请求数据解析失败', parseError);
      return NextResponse.json(
        { error: '解析请求数据失败，确保发送了有效的JSON', success: false },
        { status: 400 }
      );
    }
    
    // 验证必要字段
    logWithTime('验证请求字段');
    const { projectDetail, tasks, currentTask, evidence, githubRepoUrl } = requestData;
    
    if (!projectDetail || !tasks || !currentTask || !githubRepoUrl || !evidence) {
      const errorMsg = '缺少必要字段，需要提供projectDetail、tasks、currentTask、evidence和githubRepoUrl';
      logError(errorMsg, null);
      
      return NextResponse.json(
        { error: errorMsg, success: false }, 
        { status: 400 }
      );
    }
    
    // 生成唯一评估ID
    const evaluationId = uuidv4();
    logWithTime(`生成评估ID: ${evaluationId}`);
    logWithTime(`评估集合路径: ${COLLECTIONS.EVALUATIONS}`);
    
    // 构建评估记录
    const evaluationData = {
      id: evaluationId,
      projectDetail,
      tasks: Array.isArray(tasks) ? tasks : [tasks],
      currentTask,
      evidence,
      githubRepoUrl,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      result: null,
      error: null
    };
    
    logWithTime('准备写入评估记录到数据库...');
    logWithTime('评估数据:', evaluationData);
    
    // 创建评估记录
    try {
      await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).set(evaluationData);
      logWithTime(`评估记录已创建: ${evaluationId}`);
    } catch (createError) {
      logError('创建评估记录失败', createError);
      return NextResponse.json(
        { error: '创建评估记录失败', success: false, details: String(createError) },
        { status: 500 }
      );
    }
    
    // 使用同步模式：直接处理并等待结果
    logWithTime(`开始处理代码评估任务，ID: ${evaluationId}`);
    
    try {
      // 直接调用处理函数，等待完成
      await processEvaluation(evaluationId, projectDetail, 
                           Array.isArray(tasks) ? tasks : [tasks], 
                           currentTask, evidence, githubRepoUrl);
      
      // 处理完成后，读取结果
      const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId);
      const docSnapshot = await docRef.get();
      const evaluationData = docSnapshot.data();
      
      logWithTime(`代码评估完成，返回结果，ID: ${evaluationId}`);
      
      // 返回完整结果
      return NextResponse.json({
        success: true,
        message: '代码评估完成',
        evaluationId,
        status: 'completed',
        result: evaluationData?.result || null
      });
    } catch (processError) {
      logError(`代码评估处理失败: ${evaluationId}`, processError);
      
      // 更新数据库中的错误信息
      try {
        await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update({
          status: 'failed',
          error: processError instanceof Error ? processError.message : String(processError),
          stack: processError instanceof Error ? processError.stack : undefined,
          updatedAt: new Date()
        });
        logWithTime(`已更新数据库中的错误信息，ID: ${evaluationId}`);
      } catch (updateError) {
        logError(`更新错误信息失败: ${evaluationId}`, updateError);
      }
      
      return NextResponse.json({
        success: false,
        evaluationId,
        message: '代码评估处理失败',
        error: processError instanceof Error ? processError.message : String(processError)
      }, { status: 500 });
    }
  } catch (error) {
    logError('评估API错误', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : String(error), 
        success: false,
        stack: error instanceof Error ? error.stack : undefined
      }, 
      { status: 500 }
    );
  }
}

/**
 * 处理代码评估任务
 */
async function processEvaluation(
  evaluationId: string, 
  projectDetail: string, 
  tasks: string[], 
  currentTask: string, 
  evidence: string,
  githubRepoUrl: string
): Promise<void> {
  logWithTime(`[ID: ${evaluationId}] 开始处理代码评估任务`);
  logWithTime(`[ID: ${evaluationId}] 项目: ${projectDetail.substring(0, 100)}..., GitHub URL: ${githubRepoUrl}`);
  
  try {
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 更新状态：正在获取仓库代码
    logWithTime(`[ID: ${evaluationId}] 更新状态: 正在获取仓库代码`);
    try {
      await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update({
        status: 'processing_repo',
        statusMessage: '正在获取GitHub仓库代码',
        updatedAt: new Date()
      });
      logWithTime(`[ID: ${evaluationId}] 状态已更新为processing_repo`);
    } catch (updateError) {
      logError(`[ID: ${evaluationId}] 更新状态失败`, updateError);
      // 尽管更新状态失败，但继续处理
    }
    
    // 处理GitHub仓库
    logWithTime(`[ID: ${evaluationId}] 调用 processGitHubRepository 处理仓库...`);
    let repoSummary = '';
    let relevantFiles: Array<{path: string, content: string, relevance: number}> = [];
    
    try {
      const result = await processGitHubRepository(
        githubRepoUrl,
        projectDetail,
        tasks,
        currentTask,
        evidence,
      );
      repoSummary = result.repoSummary;
      relevantFiles = result.relevantFiles;
      
      logWithTime(`[ID: ${evaluationId}] 仓库处理完成，获取到 ${relevantFiles.length} 个相关文件`);
      logWithTime(`[ID: ${evaluationId}] 仓库摘要: ${repoSummary.substring(0, 100)}...`);
    } catch (repoError) {
      logError(`[ID: ${evaluationId}] 处理仓库失败`, repoError);
      throw new Error(`处理GitHub仓库失败: ${(repoError as Error).message}`);
    }
    
    // 更新状态：正在评估代码
    logWithTime(`[ID: ${evaluationId}] 更新状态: 正在评估代码`);
    try {
      await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update({
        status: 'evaluating',
        statusMessage: '正在评估代码',
        repoSummary,
        updatedAt: new Date()
      });
      logWithTime(`[ID: ${evaluationId}] 状态已更新为evaluating`);
    } catch (updateError) {
      logError(`[ID: ${evaluationId}] 更新状态失败`, updateError);
      // 尽管更新状态失败，但继续处理
    }
    
    // 调用 Gemini 评估代码
    logWithTime(`[ID: ${evaluationId}] 调用 Gemini 评估代码...`);
    let evaluationResult;
    
    try {
      evaluationResult = await evaluateCodeInBatches({
        projectDetail,
        tasks,
        currentTask,
        evidence,
        githubRepoUrl,
        repoSummary,
        relevantFiles
      });
      
      logWithTime(`[ID: ${evaluationId}] 代码评估完成`);
      logWithTime(`[ID: ${evaluationId}] 评估结果:`, { 
        rawContent: evaluationResult.rawContent
      });
    } catch (evaluateError) {
      logError(`[ID: ${evaluationId}] 评估代码失败`, evaluateError);
      throw new Error(`代码评估失败: ${(evaluateError as Error).message}`);
    }
    
    // 更新状态和数据库
    const updateData = {
      status: 'completed',
      statusMessage: '代码评估已完成',
      result: evaluationResult,
      updatedAt: new Date(),
      completedAt: new Date()
    };
    
    // 最终更新评估状态
    try {
      await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update(updateData);
      logWithTime(`[ID: ${evaluationId}] 最终状态已更新为completed`);
    } catch (updateError) {
      logError(`[ID: ${evaluationId}] 更新完成状态失败`, updateError);
      // 尽管更新状态失败，但已完成处理
    }
    
    logWithTime(`[ID: ${evaluationId}] 代码评估处理全部完成`);
  } catch (error) {
    logError(`[ID: ${evaluationId}] 评估处理错误`, error);
    throw error; // 将错误冒泡给调用者处理
  }
} 