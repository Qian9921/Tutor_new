import { NextResponse } from 'next/server';
import { pool, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

// 添加日志记录函数
function logWithTime(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [RESET-DATABASE-API]`, ...args);
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [RESET-DATABASE-API ERROR] ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [RESET-DATABASE-API ERROR] Stack:`, error.stack);
  }
}

/**
 * 重置数据库（删除所有表并重新创建）的API
 */
export async function POST() {
  logWithTime('POST /api/admin/reset-database - 开始处理重置数据库请求');
  
  try {
    // 确保数据库连接可用
    logWithTime('测试数据库连接...');
    const client = await pool.connect();
    logWithTime('数据库连接成功');
    
    // 删除所有表
    logWithTime('删除所有表...');
    
    for (const tableName of Object.values(COLLECTIONS)) {
      logWithTime(`删除表 ${tableName}...`);
      try {
        await client.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
        logWithTime(`表 ${tableName} 已成功删除`);
      } catch (dropError) {
        logError(`删除表 ${tableName} 失败`, dropError);
        // 继续尝试删除其他表
      }
    }
    
    client.release();
    
    // 重置数据库初始化状态，触发重新创建表
    logWithTime('触发数据库表重新创建...');
    await waitForDatabaseInitialization();
    
    logWithTime('✅ 数据库已成功重置');
    
    return NextResponse.json({
      success: true,
      message: '数据库已成功重置',
      tables: Object.values(COLLECTIONS)
    });
    
  } catch (error) {
    logError('重置数据库失败', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '重置数据库失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 