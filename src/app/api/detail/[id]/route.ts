import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

type Params = { id: string };

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
  context: { params: Params }
) {
  const id = context.params.id;
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
    
    const evaluationData = docSnapshot.data();
    logWithTime(`找到评估记录: ${id}`, evaluationData);
    
    return NextResponse.json({
      success: true,
      evaluation: {
        id,
        ...evaluationData
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