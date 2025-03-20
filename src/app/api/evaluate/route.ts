import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, Timestamp, waitForDatabaseInitialization } from '@/lib/database';
import { processGitHubRepository } from '@/lib/llamaindex';
import { evaluateCode, CodeEvaluationResult } from '@/lib/doubao';
import { v4 as uuidv4 } from 'uuid';

// 添加日志记录函数
function logWithTime(...args: any[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [EVALUATE-API]`, ...args);
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [EVALUATE-API] ERROR: ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [EVALUATE-API] Stack:`, error.stack);
  }
}

// 验证请求API密钥的中间件
function validateApiKey(request: NextRequest): boolean {
  // 生产环境中应该实现真正的API密钥验证
  // 这里简单实现，实际项目中应该更严格
  const apiKey = request.headers.get('x-api-key');
  return !!apiKey && apiKey.length > 10;
}

/**
 * 评估API处理POST请求
 */
export async function POST(request: NextRequest) {
  logWithTime('POST /api/evaluate - 开始处理评估请求');
  
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
    const { projectDetail, subtasks, currentTask, githubRepoUrl } = requestData;
    
    if (!projectDetail || !subtasks || !currentTask || !githubRepoUrl) {
      const errorMsg = '缺少必要字段，需要提供projectDetail、subtasks、currentTask和githubRepoUrl';
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
      subtasks: Array.isArray(subtasks) ? subtasks : [subtasks],
      currentTask,
      githubRepoUrl,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      result: null,
      error: null
    };
    
    logWithTime('准备写入评估记录到数据库...');
    logWithTime('评估数据:', evaluationData);
    
    // 保存评估请求到数据库
    try {
      const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId);
      logWithTime(`文档路径: ${docRef.path}`);
      
      await docRef.set(evaluationData);
      logWithTime('✅ 评估记录创建成功');
      
      // 验证记录已经写入成功
      const docSnapshot = await docRef.get();
      if (!docSnapshot.exists) {
        throw new Error(`无法验证评估记录 ${evaluationId} 是否成功创建`);
      }
      logWithTime('✅ 评估记录验证成功', docSnapshot.data());
      
    } catch (dbError) {
      logError('❌ 评估记录创建失败', dbError as Error);
      return NextResponse.json(
        { success: false, message: '评估记录创建失败', error: (dbError as Error).message },
        { status: 500 }
      );
    }
    
    // 创建后台任务处理，不阻塞响应
    logWithTime(`启动后台评估处理任务，ID: ${evaluationId}`);
    // 使用setTimeout确保请求处理不会被阻塞
    setTimeout(() => {
      processEvaluation(evaluationId, projectDetail, Array.isArray(subtasks) ? subtasks : [subtasks], currentTask, githubRepoUrl)
        .then(() => {
          logWithTime(`评估处理成功完成，ID: ${evaluationId}`);
        })
        .catch(error => {
          logError(`评估处理失败 (${evaluationId})`, error);
          // 更新数据库状态为失败
          try {
            db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update({
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              updatedAt: new Date()
            });
            logWithTime(`已更新数据库状态为失败，ID: ${evaluationId}`);
          } catch (updateErr) {
            logError('更新失败状态失败', updateErr);
          }
        });
    }, 100);
    
    // 立即返回响应，包含评估ID
    logWithTime(`返回评估请求响应，ID: ${evaluationId}`);
    return NextResponse.json({
      success: true,
      message: '评估请求已接收，正在处理中',
      evaluationId,
      status: 'pending'
    });
    
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
 * 后台处理评估任务
 */
async function processEvaluation(
  evaluationId: string, 
  projectDetail: string, 
  subtasks: string[], 
  currentTask: string, 
  githubRepoUrl: string
): Promise<void> {
  logWithTime(`[ID: ${evaluationId}] 开始处理评估任务`);
  logWithTime(`[ID: ${evaluationId}] 项目: ${projectDetail}, GitHub URL: ${githubRepoUrl}`);
  
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
        subtasks,
        currentTask
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
    
    // 调用豆包API评估代码
    logWithTime(`[ID: ${evaluationId}] 调用豆包API评估代码...`);
    let evaluationResult: CodeEvaluationResult;
    
    try {
      evaluationResult = await evaluateCode({
        projectDetail,
        subtasks,
        currentTask,
        githubRepoUrl,
        repoSummary,
        relevantFiles
      });
      
      logWithTime(`[ID: ${evaluationId}] 代码评估完成`);
      logWithTime(`[ID: ${evaluationId}] 评估结果:`, { 
        overall: evaluationResult.overall,
        quality: evaluationResult.quality,
        functionality: evaluationResult.functionality,
        maintainability: evaluationResult.maintainability,
        security: evaluationResult.security
      });
    } catch (evaluateError) {
      logError(`[ID: ${evaluationId}] 评估代码失败`, evaluateError);
      throw new Error(`代码评估失败: ${(evaluateError as Error).message}`);
    }
    
    // 更新状态：评估完成
    logWithTime(`[ID: ${evaluationId}] 更新状态: 评估完成`);
    try {
      await db.collection(COLLECTIONS.EVALUATIONS).doc(evaluationId).update({
        status: 'completed',
        statusMessage: '评估已完成',
        result: evaluationResult,
        updatedAt: new Date(),
        completedAt: new Date()
      });
      logWithTime(`[ID: ${evaluationId}] 状态已更新为completed`);
    } catch (updateError) {
      logError(`[ID: ${evaluationId}] 更新完成状态失败`, updateError);
      // 尽管更新状态失败，但已完成处理
    }
    
    logWithTime(`[ID: ${evaluationId}] 评估处理全部完成`);
  } catch (error) {
    logError(`[ID: ${evaluationId}] 评估处理错误`, error);
    throw error; // 将错误冒泡给调用者处理
  }
} 