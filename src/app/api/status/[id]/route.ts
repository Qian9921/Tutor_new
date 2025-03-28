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
    console.log(`[${timestamp}] [STATUS API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [STATUS API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [STATUS API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

/**
 * 获取评估状态
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const id = (await context.params).id;
  logWithTime(`GET /api/status/${id} - 获取评估状态`);
  
  try {
    if (!id) {
      throw new Error('缺少评估ID');
    }
    
    // 检查是否请求等待结果完成
    const url = new URL(request.url);
    const waitParam = url.searchParams.get('wait');
    const waitForResult = waitParam === 'true' || waitParam === '1';
    const waitTimeout = Number(url.searchParams.get('timeout')) || 60000; // 默认等待60秒
    
    if (waitForResult) {
      logWithTime(`等待模式：将等待结果完成，超时时间 ${waitTimeout/1000} 秒`);
    }
    
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 如果请求等待结果，则设置最大尝试次数和间隔
    if (waitForResult) {
      const maxAttempts = Math.ceil(waitTimeout / 2000); // 每2秒检查一次
      const interval = 2000; // 2秒
      
      // 轮询检查评估状态
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(id);
        const docSnapshot = await docRef.get();
        
        if (!docSnapshot.exists) {
          logWithTime(`评估ID不存在: ${id}`);
          return NextResponse.json(
            { success: false, message: '评估不存在或已删除' },
            { status: 404 }
          );
        }
        
        const evaluationData = docSnapshot.data() as EvaluationData;
        
        if (!evaluationData) {
          logWithTime(`评估数据为空: ${id}`);
          return NextResponse.json(
            { success: false, message: '评估数据为空' },
            { status: 404 }
          );
        }
        
        // 检查是否已完成或已有结果
        const isCompleted = evaluationData.status === 'completed';
        const hasFailed = evaluationData.status === 'failed';
        const hasResult = evaluationData.result && 
                          typeof evaluationData.result === 'object' && 
                          evaluationData.result !== null && 
                          'rawContent' in evaluationData.result;
        
        if (isCompleted || hasFailed || hasResult) {
          logWithTime(`获取评估状态成功 (${attempt+1}次尝试): ${id}，状态: ${evaluationData.status}`);
          
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
            status: evaluationData.status,
            statusMessage: evaluationData.statusMessage,
            updatedAt: evaluationData.updatedAt,
            result: formattedResult
          });
        }
        
        // 如果不是最后一次尝试，则等待后继续
        if (attempt < maxAttempts - 1) {
          logWithTime(`评估仍在进行中 (${attempt+1}/${maxAttempts})，等待${interval/1000}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, interval));
        }
      }
      
      // 如果达到最大尝试次数仍未完成，返回当前状态
      logWithTime(`等待超时，返回当前状态: ${id}`);
      const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(id);
      const docSnapshot = await docRef.get();
      const evaluationData = docSnapshot.data() as EvaluationData;
      
      return NextResponse.json({
        success: true,
        status: evaluationData?.status || 'unknown',
        statusMessage: evaluationData?.statusMessage || '等待超时，评估可能仍在进行中',
        updatedAt: evaluationData?.updatedAt,
        result: evaluationData?.result
      });
    } else {
      // 常规状态检查，不等待结果
      const docRef = db.collection(COLLECTIONS.EVALUATIONS).doc(id);
      const docSnapshot = await docRef.get();
      
      if (!docSnapshot.exists) {
        logWithTime(`评估ID不存在: ${id}`);
        
        return NextResponse.json(
          { 
            success: false, 
            message: '评估不存在或已删除' 
          }, 
          { status: 404 }
        );
      }
      
      const evaluationData = docSnapshot.data() as EvaluationData;
      
      // 确保evaluationData不为null
      if (!evaluationData) {
        logWithTime(`评估数据为空: ${id}`);
        return NextResponse.json(
          { 
            success: false, 
            message: '评估数据为空' 
          }, 
          { status: 404 }
        );
      }
      
      logWithTime(`获取评估状态成功: ${id}`, evaluationData);
      
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
        status: evaluationData.status,
        statusMessage: evaluationData.statusMessage,
        updatedAt: evaluationData.updatedAt,
        result: formattedResult
      });
    }
  } catch (error) {
    logError(`获取评估状态失败: ${id}`, error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '获取评估状态失败', 
        error: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
} 