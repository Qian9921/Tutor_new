import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [EVALUATIONS API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [EVALUATIONS API] ${message}`);
  }
}

function logError(message: string, error: any) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [EVALUATIONS API ERROR] ${message}`, error);
  console.error(`Stack: ${error.stack || 'No stack trace'}`);
}

/**
 * 获取评估记录列表
 */
export async function GET(request: NextRequest) {
  logWithTime('GET /api/evaluations - 获取评估列表');
  
  try {
    // 确保数据库已初始化
    logWithTime('等待数据库初始化完成...');
    try {
      await waitForDatabaseInitialization();
      logWithTime('数据库初始化成功');
    } catch (dbError) {
      const errorMsg = '数据库初始化失败，无法获取评估列表';
      logError(errorMsg, dbError);
      return NextResponse.json(
        { success: false, message: errorMsg, error: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500 }
      );
    }
    
    // 从数据库获取评估列表
    logWithTime(`从 ${COLLECTIONS.EVALUATIONS} 中获取评估记录...`);
    
    try {
      const result = await db.collection(COLLECTIONS.EVALUATIONS).get();
      
      if (result.empty) {
        logWithTime('没有找到评估记录');
        return NextResponse.json({ success: true, evaluations: [] });
      }
      
      // 将数据转换为前端需要的格式
      const evaluations = result.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data
        };
      });
      
      // 按创建时间排序，最新的在前面
      evaluations.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });
      
      logWithTime(`找到 ${evaluations.length} 条评估记录`);
      
      return NextResponse.json({
        success: true,
        evaluations
      });
    } catch (queryError) {
      const errorMsg = `查询评估记录失败: ${(queryError as Error).message}`;
      logError(errorMsg, queryError);
      return NextResponse.json(
        { success: false, message: errorMsg },
        { status: 500 }
      );
    }
  } catch (error) {
    logError('获取评估列表失败', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '获取评估列表失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

/**
 * 创建新的评估记录
 */
export async function POST(request: NextRequest) {
  logWithTime('POST /api/evaluations - 创建新评估');
  
  try {
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    // 解析请求数据
    const data = await request.json();
    
    // 调用评估API创建评估
    const apiUrl = new URL('/api/evaluate', request.url).toString();
    logWithTime('转发请求到评估API', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`评估API响应错误: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    
    return NextResponse.json(result);
  } catch (error) {
    logError('创建评估失败', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '创建评估失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 