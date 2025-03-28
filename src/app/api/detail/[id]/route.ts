import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';
import { VideoEvaluationResult } from '@/lib/doubao';

// 定义评估数据类型
interface EvaluationData {
  result?: any;
  videoEvaluation?: VideoEvaluationResult;
  status?: string;
  statusMessage?: string;
  updatedAt?: any;
  [key: string]: any;
}

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [DETAIL API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [DETAIL API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [DETAIL API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

/**
 * 获取单个评估记录详情
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const id = (await context.params).id;
  logWithTime(`GET /api/detail/${id} - 获取评估详情`);
  
  try {
    if (!id) {
      throw new Error('缺少评估ID');
    }
    
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 从数据库获取评估记录
    logWithTime(`从 ${COLLECTIONS.EVALUATIONS} 获取评估记录: ${id}`);
    const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(id);
    const docSnapshot = await docRef.get();
    
    if (!docSnapshot.exists) {
      logWithTime(`未找到评估记录: ${id}`);
      return NextResponse.json(
        { success: false, message: '未找到该评估记录' },
        { status: 404 }
      );
    }
    
    const evaluationData = docSnapshot.data() as EvaluationData;
    
    // 确保evaluationData不为null
    if (!evaluationData) {
      logWithTime(`评估数据为空: ${id}`);
      return NextResponse.json(
        { success: false, message: '评估数据为空' },
        { status: 404 }
      );
    }
    
    logWithTime(`找到评估记录: ${id}`, evaluationData);
    
    // 确保评估结果格式一致，支持终审模式下代码和视频评估结果的呈现
    let formattedResult: any = evaluationData.result || null;
    
    // 检查是否需要将视频评估结果合并到评估结果中（保持videoRawContent与rawContent平级）
    if (formattedResult && 
        !formattedResult.videoRawContent && 
        evaluationData.videoEvaluation && 
        evaluationData.videoEvaluation.videoRawContent) {
      // 深拷贝以避免修改原始数据
      formattedResult = JSON.parse(JSON.stringify(formattedResult));
      // 将videoRawContent放在与rawContent同级
      formattedResult.videoRawContent = evaluationData.videoEvaluation.videoRawContent;
      logWithTime(`为评估 ${id} 合并了视频评估结果（与rawContent平级）`);
    }
    
    return NextResponse.json({
      success: true,
      evaluation: {
        ...evaluationData,
        result: formattedResult,
        id
      }
    });
  } catch (error) {
    logError(`获取评估详情失败: ${id}`, error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '获取评估详情失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 