import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// 网络错误相关类型
interface NetworkErrorLike {
  code?: string;
  hostname?: string;
  [key: string]: unknown;
}

// 数据库行记录类型
interface DatabaseRow {
  id: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  status_message?: string;
  github_repo_url?: string;
  repo_summary?: string;
  project_detail?: string;
  current_task?: string;
  [key: string]: unknown;
}

// 数据库文档数据类型
type DocumentData = Record<string, unknown>;

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [DATABASE] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [DATABASE] ${message}`);
  }
}

function logError(message: string, error: Error | unknown | null) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [DATABASE ERROR] ${message}`, error);
  if (error instanceof Error && error.stack) {
    console.error(`[${timestamp}] [DATABASE ERROR] Stack:`, error.stack);
  }
  
  // 添加网络错误的特殊处理
  if (error && typeof error === 'object' && 'code' in error) {
    const errObj = error as NetworkErrorLike;
    if (errObj.code === 'ENOTFOUND') {
      console.error(`[${timestamp}] [DATABASE ERROR] 网络错误: 无法解析数据库主机名。请检查您的网络连接或DNS设置。`);
      console.error(`[${timestamp}] [DATABASE ERROR] 主机名: ${errObj.hostname || '未知'}`);
    } else if (errObj.code === 'ECONNREFUSED') {
      console.error(`[${timestamp}] [DATABASE ERROR] 网络错误: 连接被拒绝。请确认数据库服务器是否运行以及网络设置是否正确。`);
    } else if (errObj.code === 'ETIMEDOUT') {
      console.error(`[${timestamp}] [DATABASE ERROR] 网络错误: 连接超时。这可能是网络延迟或服务器未响应导致的。`);
    }
  }
}

// 创建数据库连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000, // 连接超时时间，10秒
  max: 5, // 最大连接数
  idleTimeoutMillis: 30000, // 空闲连接超时，30秒
  ssl: (process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL)?.includes('sslmode=require') ? true : false, // 根据连接字符串决定是否使用SSL
});

// 表前缀
const TABLE_PREFIX = process.env.DATABASE_TABLE_PREFIX || 'tutor';

// 集合/表名称
export const COLLECTIONS = {
  EVALUATIONS: `${TABLE_PREFIX}_evaluations`,
  CACHE: `${TABLE_PREFIX}_cache`,
  GITHUB_REPOS: `${TABLE_PREFIX}_github_repos`,
  SYSTEM_LOGS: `${TABLE_PREFIX}_system_logs`,
};

// 数据库初始化状态
let databaseInitialized = false;
let initializationError: Error | null = null;
let initializationPromise: Promise<boolean> | null = null;

// 初始化数据库表
async function initializeDatabase() {
  logWithTime('初始化数据库表...');
  
  // 最大重试次数
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      // 测试连接
      const client = await pool.connect();
      logWithTime('数据库连接成功');
      client.release();
      
      // 创建评估表
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${COLLECTIONS.EVALUATIONS} (
          id TEXT PRIMARY KEY,
          project_detail TEXT,
          subtasks JSONB,
          current_task TEXT,
          github_repo_url TEXT,
          status TEXT,
          status_message TEXT,
          repo_summary TEXT,
          result JSONB,
          error TEXT,
          stack TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE
        )
      `);
      
      // 创建缓存表
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${COLLECTIONS.CACHE} (
          id TEXT PRIMARY KEY,
          data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP WITH TIME ZONE
        )
      `);
      
      // 创建GitHub仓库表
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${COLLECTIONS.GITHUB_REPOS} (
          id TEXT PRIMARY KEY,
          owner TEXT,
          repo TEXT,
          summary TEXT,
          files JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 创建系统日志表
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${COLLECTIONS.SYSTEM_LOGS} (
          id TEXT PRIMARY KEY,
          message TEXT,
          data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 验证所有表是否已创建
      logWithTime('验证表是否创建成功...');
      
      // 获取所有表名
      const tableNames = Object.values(COLLECTIONS);
      
      // 验证每个表是否存在
      for (const tableName of tableNames) {
        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM pg_tables 
            WHERE tablename = $1
          )
        `, [tableName.replace(/^.*\./, '')]);
        
        const tableExists = tableCheck.rows[0].exists;
        
        if (!tableExists) {
          throw new Error(`表 ${tableName} 创建失败或不存在`);
        }
        
        logWithTime(`表 ${tableName} 验证成功`);
      }
      
      logWithTime('数据库表初始化成功');
      databaseInitialized = true;
      return true;
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // 记录重试信息
      logWithTime(`数据库连接失败，正在进行第${retryCount}次重试，共${maxRetries}次`);
      
      // 如果不是最后一次重试，等待一段时间后再尝试
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      }
    }
  }
  
  // 所有重试都失败
  logError('数据库表初始化失败，达到最大重试次数', lastError);
  initializationError = lastError as Error;
  return false;
}

// 等待数据库初始化完成的函数
async function waitForDatabaseInitialization(): Promise<boolean> {
  if (databaseInitialized) {
    return true;
  }
  
  if (initializationError) {
    throw initializationError;
  }
  
  if (!initializationPromise) {
    initializationPromise = initializeDatabase();
  }
  
  return await initializationPromise;
}

// 创建一个类似于Firestore的API，适配现有代码
class Collection {
  constructor(private tableName: string) {}
  
  // 获取文档引用
  doc(id: string) {
    return new Document(this.tableName, id);
  }
  
  // 添加新文档（自动生成ID）
  async add(data: DocumentData) {
    const id = uuidv4();
    const doc = new Document(this.tableName, id);
    await doc.set(data);
    return doc;
  }
  
  // 获取所有文档
  async get() {
    try {
      const result = await pool.query(`SELECT * FROM ${this.tableName}`);
      return {
        docs: result.rows.map(row => ({
          id: row.id,
          data: () => this.convertToFirestoreFormat(row),
          exists: true
        })),
        empty: result.rows.length === 0
      };
    } catch (error) {
      logError(`获取集合(${this.tableName})失败`, error);
      throw error;
    }
  }
  
  // 将PostgreSQL行格式转换为Firestore格式
  private convertToFirestoreFormat(row: DatabaseRow) {
    const result = { ...row };
    
    // 转换日期字段为JavaScript Date对象
    if (result.created_at) {
      result.createdAt = new Date(result.created_at);
      delete result.created_at;
    }
    
    if (result.updated_at) {
      result.updatedAt = new Date(result.updated_at);
      delete result.updated_at;
    }
    
    if (result.completed_at) {
      result.completedAt = new Date(result.completed_at);
      delete result.completed_at;
    }
    
    if (result.status_message) {
      result.statusMessage = result.status_message;
      delete result.status_message;
    }
    
    if (result.github_repo_url) {
      result.githubRepoUrl = result.github_repo_url;
      delete result.github_repo_url;
    }
    
    if (result.repo_summary) {
      result.repoSummary = result.repo_summary;
      delete result.repo_summary;
    }
    
    if (result.project_detail) {
      result.projectDetail = result.project_detail;
      delete result.project_detail;
    }
    
    if (result.current_task) {
      result.currentTask = result.current_task;
      delete result.current_task;
    }
    
    return result;
  }
}

class Document {
  constructor(private tableName: string, private id: string) {}
  
  // 设置文档数据
  async set(data: DocumentData) {
    try {
      logWithTime(`设置文档 ${this.tableName}/${this.id}`);
      
      // 将数据转换为PostgreSQL格式
      const pgData = this.convertToPgFormat(data);
      
      // 创建列名和值
      const columns = Object.keys(pgData);
      const values = Object.values(pgData);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      
      // 只在columns中不存在id时才添加id
      if (!columns.includes('id')) {
        columns.push('id');
        values.push(this.id);
      }
      
      // 创建冲突更新部分
      const updateSet = columns
        .filter(col => col !== 'id' && col !== 'created_at' && col !== 'updated_at')
        .map(col => `${col} = EXCLUDED.${col}`)
        .join(', ');
      
      // 执行upsert操作
      let query;
      if (this.tableName === COLLECTIONS.SYSTEM_LOGS) {
        // SYSTEM_LOGS表没有updated_at列，所以不更新它
        query = `
          INSERT INTO ${this.tableName} (${columns.join(', ')})
          VALUES (${placeholders}, $${values.length > columns.length ? values.length : columns.length})
          ON CONFLICT (id) DO UPDATE SET ${updateSet}
        `;
      } else {
        // 其他表有updated_at列，正常更新
        query = `
          INSERT INTO ${this.tableName} (${columns.join(', ')})
          VALUES (${placeholders}, $${values.length > columns.length ? values.length : columns.length})
          ON CONFLICT (id) DO UPDATE SET ${updateSet ? updateSet + ', ' : ''}updated_at = CURRENT_TIMESTAMP
        `;
      }
      
      await pool.query(query, values);
      logWithTime(`文档 ${this.tableName}/${this.id} 保存成功`);
      
      return { id: this.id };
    } catch (error) {
      logError(`设置文档(${this.tableName}/${this.id})失败`, error);
      throw error;
    }
  }
  
  // 更新文档部分字段
  async update(data: DocumentData) {
    try {
      logWithTime(`更新文档 ${this.tableName}/${this.id}`);
      
      // 将数据转换为PostgreSQL格式
      const pgData = this.convertToPgFormat(data);
      
      // 创建SET部分
      const sets = Object.keys(pgData).map((key, i) => `${key} = $${i + 1}`);
      
      // 只为非SYSTEM_LOGS表添加updated_at更新
      if (this.tableName !== COLLECTIONS.SYSTEM_LOGS) {
        sets.push('updated_at = CURRENT_TIMESTAMP');
      }
      
      // 添加id到值数组末尾
      const values = [...Object.values(pgData), this.id];
      
      // 执行更新操作
      const query = `
        UPDATE ${this.tableName}
        SET ${sets.join(', ')}
        WHERE id = $${values.length}
      `;
      
      const result = await pool.query(query, values);
      
      if (result.rowCount === 0) {
        throw new Error(`文档 ${this.tableName}/${this.id} 不存在`);
      }
      
      logWithTime(`文档 ${this.tableName}/${this.id} 更新成功`);
      
      return { id: this.id };
    } catch (error) {
      logError(`更新文档(${this.tableName}/${this.id})失败`, error);
      throw error;
    }
  }
  
  // 获取文档
  async get() {
    try {
      logWithTime(`获取文档 ${this.tableName}/${this.id}`);
      
      const result = await pool.query(
        `SELECT * FROM ${this.tableName} WHERE id = $1`,
        [this.id]
      );
      
      if (result.rows.length === 0) {
        logWithTime(`文档 ${this.tableName}/${this.id} 不存在`);
        return {
          exists: false,
          data: () => null,
          id: this.id
        };
      }
      
      logWithTime(`文档 ${this.tableName}/${this.id} 获取成功`);
      
      return {
        exists: true,
        data: () => this.convertToFirestoreFormat(result.rows[0]),
        id: this.id
      };
    } catch (error) {
      logError(`获取文档(${this.tableName}/${this.id})失败`, error);
      throw error;
    }
  }
  
  // 删除文档
  async delete() {
    try {
      logWithTime(`删除文档 ${this.tableName}/${this.id}`);
      
      await pool.query(
        `DELETE FROM ${this.tableName} WHERE id = $1`,
        [this.id]
      );
      
      logWithTime(`文档 ${this.tableName}/${this.id} 删除成功`);
      
      return { id: this.id };
    } catch (error) {
      logError(`删除文档(${this.tableName}/${this.id})失败`, error);
      throw error;
    }
  }
  
  // 返回文档路径
  get path() {
    return `${this.tableName}/${this.id}`;
  }
  
  // 将JavaScript对象转换为PostgreSQL格式
  private convertToPgFormat(data: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(data)) {
      // 跳过id字段，因为会在set/update方法中单独处理
      if (key === 'id') continue;
      
      // 跳过updatedAt字段，因为在SQL语句中会单独使用CURRENT_TIMESTAMP更新
      if (key === 'updatedAt') continue;
      
      // 转换驼峰命名为下划线命名
      const pgKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      
      if (key === 'createdAt') {
        result['created_at'] = value;
      } else if (key === 'completedAt') {
        result['completed_at'] = value;
      } else if (value === null) {
        // 处理null值
        result[pgKey] = null;
      } else if (Array.isArray(value) || typeof value === 'object') {
        // 将数组和对象转换为JSONB，需要显式地序列化为JSON字符串
        result[pgKey] = JSON.stringify(value);
      } else {
        result[pgKey] = value;
      }
    }
    
    return result;
  }
  
  // 将PostgreSQL行格式转换为Firestore格式
  private convertToFirestoreFormat(row: DatabaseRow) {
    const result = { ...row };
    
    // 转换日期字段为JavaScript Date对象
    if (result.created_at) {
      result.createdAt = new Date(result.created_at);
      delete result.created_at;
    }
    
    if (result.updated_at) {
      result.updatedAt = new Date(result.updated_at);
      delete result.updated_at;
    }
    
    if (result.completed_at) {
      result.completedAt = new Date(result.completed_at);
      delete result.completed_at;
    }
    
    if (result.status_message) {
      result.statusMessage = result.status_message;
      delete result.status_message;
    }
    
    if (result.github_repo_url) {
      result.githubRepoUrl = result.github_repo_url;
      delete result.github_repo_url;
    }
    
    if (result.repo_summary) {
      result.repoSummary = result.repo_summary;
      delete result.repo_summary;
    }
    
    if (result.project_detail) {
      result.projectDetail = result.project_detail;
      delete result.project_detail;
    }
    
    if (result.current_task) {
      result.currentTask = result.current_task;
      delete result.current_task;
    }
    
    return result;
  }
}

// 测试数据库连接
async function testDatabaseConnection() {
  try {
    // 确保数据库已初始化
    await waitForDatabaseInitialization();
    
    logWithTime('测试数据库连接...');
    
    // 最大重试次数
    const maxRetries = 3;
    let retryCount = 0;
    let lastError = null;
    
    while (retryCount < maxRetries) {
      try {
        const client = await pool.connect();
        logWithTime('数据库连接成功');
        
        // 插入测试日志
        const testId = `connection-test-${Date.now()}`;
        await client.query(
          `INSERT INTO ${COLLECTIONS.SYSTEM_LOGS} (id, message) VALUES ($1, $2)`,
          [testId, 'Database connection test']
        );
        
        logWithTime('测试日志写入成功');
        client.release();
        
        return true;
      } catch (error) {
        lastError = error;
        retryCount++;
        
        // 记录重试信息
        logWithTime(`数据库连接测试失败，正在进行第${retryCount}次重试，共${maxRetries}次`);
        
        // 如果不是最后一次重试，等待一段时间后再尝试
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
        }
      }
    }
    
    // 所有重试都失败
    logError('数据库连接测试失败，达到最大重试次数', lastError);
    return false;
  } catch (error) {
    logError('数据库连接测试失败', error);
    return false;
  }
}

// 创建类似于Firestore的数据库实例
class Database {
  constructor() {}
  
  // 获取集合引用
  collection(name: string) {
    return new Collection(name);
  }
}

// 创建数据库实例
const db = new Database();

// 导出工具函数，模拟Firestore的Timestamp类
class Timestamp {
  static now() {
    return new Date();
  }
  
  static fromDate(date: Date) {
    return date;
  }
}

// 初始化数据库 - 但不等待初始化完成
initializationPromise = initializeDatabase();

// 导出接口
export { db, testDatabaseConnection, Timestamp, waitForDatabaseInitialization }; 