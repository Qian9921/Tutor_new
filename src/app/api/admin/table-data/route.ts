import { NextRequest, NextResponse } from 'next/server';
import { pool, COLLECTIONS, waitForDatabaseInitialization } from '@/lib/database';

// 添加日志记录函数
function logWithTime(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [TABLE-DATA-API]`, ...args);
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [TABLE-DATA-API ERROR] ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [TABLE-DATA-API ERROR] Stack:`, error.stack);
  }
}

/**
 * 获取特定表的数据
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tableName = url.searchParams.get('table');
  
  logWithTime(`GET /api/admin/table-data - 开始获取表 ${tableName} 的数据`);
  
  if (!tableName) {
    return NextResponse.json(
      { success: false, message: '缺少表名参数' },
      { status: 400 }
    );
  }
  
  // 安全检查：确保表名是系统中已定义的表
  const validTables = Object.values(COLLECTIONS);
  if (!validTables.includes(tableName)) {
    return NextResponse.json(
      { success: false, message: '无效的表名' },
      { status: 400 }
    );
  }
  
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
    
    // 获取表数据
    logWithTime(`获取表 ${tableName} 的数据...`);
    const client = await pool.connect();
    
    try {
      // 获取表的列信息
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      const columnsResult = await client.query(columnsQuery, [tableName.replace(/^.*\./, '')]);
      const columns = columnsResult.rows.map(row => row.column_name);
      
      // 获取表数据，最多返回100行
      const dataResult = await client.query(`SELECT * FROM ${tableName} LIMIT 100`);
      
      // 处理JSONB列
      const rows = dataResult.rows.map(row => {
        const processedRow: Record<string, unknown> = {};
        
        for (const key in row) {
          let value = row[key];
          
          // 尝试解析JSONB字段
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try {
              value = JSON.parse(value);
            } catch {
              // 如果无法解析为JSON，保持原样
            }
          }
          
          processedRow[key] = value;
        }
        
        return processedRow;
      });
      
      logWithTime(`获取到 ${rows.length} 行数据，${columns.length} 个列`);
      
      return NextResponse.json({
        success: true,
        tableName,
        columns,
        rows,
        rowCount: rows.length,
        hasMore: rows.length === 100 // 如果返回了100行，可能还有更多数据
      });
    } finally {
      client.release();
    }
  } catch (error) {
    logError(`获取表 ${tableName} 数据失败`, error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: `获取表 ${tableName} 数据失败`,
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
} 