import { NextResponse } from 'next/server';
import { pool, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

// 添加日志记录函数
function logWithTime(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [DATABASE-TABLES-API]`, ...args);
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [DATABASE-TABLES-API ERROR] ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [DATABASE-TABLES-API ERROR] Stack:`, error.stack);
  }
}

/**
 * 获取数据库中所有表的信息
 */
export async function GET() {
  logWithTime('GET /api/admin/database-tables - 开始获取表信息');
  
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
    
    // 获取所有表名和行数
    logWithTime('获取表信息...');
    const client = await pool.connect();
    
    try {
      const tableNames = Object.values(COLLECTIONS);
      const tables = [];
      
      for (const tableName of tableNames) {
        // 检查表是否存在
        const tableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM pg_tables 
            WHERE tablename = $1
          )
        `, [tableName.replace(/^.*\./, '')]);
        
        if (tableCheck.rows[0].exists) {
          // 获取表的行数
          const countResult = await client.query(`SELECT COUNT(*) FROM ${tableName}`);
          const rowCount = parseInt(countResult.rows[0].count, 10);
          
          tables.push({
            name: tableName,
            rowCount
          });
        }
      }
      
      logWithTime(`找到 ${tables.length} 个表`);
      
      return NextResponse.json({
        success: true,
        tables
      });
    } finally {
      client.release();
    }
  } catch (error) {
    logError('获取表信息失败', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: '获取表信息失败',
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 