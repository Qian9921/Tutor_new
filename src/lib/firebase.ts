import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { HttpProxyAgent } from 'http-proxy-agent';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { SocksProxyAgent } from 'socks-proxy-agent';
import { COLLECTIONS } from './firebase-client';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [FIREBASE ADMIN] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [FIREBASE ADMIN] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [FIREBASE ADMIN ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// 检查必要的环境变量
function checkEnvironmentVariables() {
  const requiredVars = [
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    const errorMsg = `缺少关键环境变量: ${missingVars.join(', ')}`;
    logError(errorMsg, { missingVars });
    throw new Error(errorMsg);
  }
  
  // 检查FIREBASE_PRIVATE_KEY格式
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey && !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    logError('FIREBASE_PRIVATE_KEY 格式不正确，可能需要替换转义字符', { 
      length: privateKey.length,
      prefix: privateKey.substring(0, 20) + '...'
    });
  }
  
  // 记录环境变量状态
  logWithTime('环境变量检查通过', {
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 
      process.env.FIREBASE_CLIENT_EMAIL.substring(0, 10) + '...' : undefined,
    privateKeyExists: !!process.env.FIREBASE_PRIVATE_KEY,
    privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length
  });
}

// 禁用代理设置，因为它可能导致连接问题
// const HTTP_PROXY = 'http://localhost:33210';
// const SOCKS_PROXY = 'socks://localhost:33211';

// 创建空的代理代理实例，避免实际使用代理
const httpProxyAgent = null;
const socksProxyAgent = null;

// 检查环境变量
try {
  checkEnvironmentVariables();
} catch (error) {
  logError('环境变量检查失败，可能导致连接问题', error);
  // 继续执行，但记录错误
}

// Firebase Admin初始化设置
if (!getApps().length) {
  try {
    logWithTime('初始化Firebase Admin SDK...');
    logWithTime('使用项目ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    
    // 替换转义字符
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    if (privateKey.includes('\\n')) {
      logWithTime('检测到FIREBASE_PRIVATE_KEY中有转义字符，进行替换');
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    const credential = cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    });
    
    logWithTime('证书对象创建成功');
    
    initializeApp({
      credential,
      // 移除databaseURL配置，因为我们只使用Firestore
      // 移除代理设置，直接连接
    });
    
    logWithTime('Firebase Admin SDK初始化成功');
  } catch (error) {
    logError('Firebase Admin SDK初始化失败', error);
    throw new Error(`Firebase Admin初始化错误: ${(error as Error).message}`);
  }
}

// 获取Firestore实例
let adminDb: Firestore;
try {
  logWithTime('获取Firestore Admin实例...');
  adminDb = getFirestore();
  logWithTime('Firestore Admin实例获取成功');
} catch (error) {
  logError('获取Firestore Admin实例失败', error);
  throw new Error(`获取Firestore实例错误: ${(error as Error).message}`);
}

// 测试Firestore连接
async function testFirestoreConnection() {
  try {
    logWithTime('测试Firestore连接...');
    logWithTime('使用集合前缀:', COLLECTIONS.EVALUATIONS);
    
    // 创建一个唯一的测试文档ID
    const testDocId = `connection-test-${Date.now()}`;
    logWithTime(`测试文档ID: ${testDocId}`);
    
    // 尝试写入测试文档
    const testDocRef = adminDb.collection(COLLECTIONS.EVALUATIONS).doc(testDocId);
    logWithTime(`文档引用创建成功: ${testDocRef.path}`);
    
    await testDocRef.set({
      test: true,
      timestamp: new Date()
    });
    
    logWithTime(`测试文档写入成功: ${testDocId}`);
    
    // 尝试读取测试文档
    const docSnapshot = await testDocRef.get();
    
    if (docSnapshot.exists) {
      logWithTime('测试文档读取成功，数据:', docSnapshot.data());
      
      // 清理测试文档
      await testDocRef.delete();
      logWithTime('测试文档清理成功');
      
      logWithTime('Firestore连接测试完成: 成功');
      return true;
    } else {
      logError('测试文档读取失败: 文档不存在', { docId: testDocId });
      return false;
    }
  } catch (error) {
    logError('Firestore连接测试失败', error);
    return false;
  }
}

// 导出时测试连接
testFirestoreConnection()
  .then((success) => {
    if (success) {
      logWithTime('Firestore连接正常');
    } else {
      logWithTime('Firestore连接测试失败，请检查配置和网络');
    }
  })
  .catch((error) => {
    logError('Firestore连接测试异常', error);
  });

export { adminDb, httpProxyAgent, socksProxyAgent }; 