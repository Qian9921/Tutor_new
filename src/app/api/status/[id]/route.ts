import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

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
  context: { params: { id: string } }
) {
  const id = context.params.id;
  logWithTime(`GET /api/status/${id} - 获取评估状态`);
  
  try {
    if (!id) {
      throw new Error('缺少评估ID');
    }
    
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
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
    
    const evaluationData = docSnapshot.data();
    
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
    
    return NextResponse.json({
      success: true,
      status: evaluationData.status,
      statusMessage: evaluationData.statusMessage,
      updatedAt: evaluationData.updatedAt,
      result: evaluationData.result
    });
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