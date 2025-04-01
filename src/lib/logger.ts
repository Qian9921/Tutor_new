/**
 * 共享日志工具函数
 */

/**
 * 带时间戳的日志函数
 * @param module 模块名称
 * @param message 日志消息
 * @param data 可选数据
 */
export function logWithTime(module: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [${module}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [${module}] ${message}`);
  }
}

/**
 * 带时间戳的错误日志函数
 * @param module 模块名称
 * @param message 错误消息
 * @param error 错误对象
 */
export function logError(module: string, message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${module} ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
} 