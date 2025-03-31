import { NextResponse } from 'next/server';
import { pool, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

// 添加日志记录函数
function logWithTime(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [CLEAR-CACHE-API]`, ...args);
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [CLEAR-CACHE-API ERROR] ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [CLEAR-CACHE-API ERROR] Stack:`, error.stack);
  }
}

/**
 * 清除所有缓存数据的API
 */
export async function POST() {
  logWithTime('POST /api/admin/clear-cache - 开始处理清除缓存请求');
  
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
    
    // 清除缓存表中的所有数据
    logWithTime('清除缓存表数据...');
    await pool.query(`TRUNCATE TABLE ${COLLECTIONS.CACHE}`);
    
    logWithTime('✅ 缓存表已清空');
    
    return NextResponse.json({
      success: true,
      message: '缓存已成功清除'
    });
    
  } catch (error) {
    logError('清除缓存失败', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '清除缓存失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 