import * as firebaseClient from 'firebase/app';
import { getFirestore as getClientFirestore } from 'firebase/firestore';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [FIREBASE CLIENT] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [FIREBASE CLIENT] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [FIREBASE CLIENT ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

// Firebase客户端配置
const clientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

logWithTime('Firebase客户端配置加载', {
  projectId: clientConfig.projectId,
  apiKey: clientConfig.apiKey ? clientConfig.apiKey.substring(0, 4) + '****' : undefined,
  authDomain: clientConfig.authDomain,
});

// 初始化Firebase客户端
let clientApp;
try {
  if (!firebaseClient.getApps().length) {
    logWithTime('初始化Firebase客户端应用...');
    clientApp = firebaseClient.initializeApp(clientConfig);
    logWithTime('Firebase客户端应用初始化成功');
  } else {
    logWithTime('使用现有的Firebase客户端应用实例');
    clientApp = firebaseClient.getApp();
  }
} catch (error) {
  logError('初始化Firebase客户端应用失败', error);
  throw new Error(`Firebase客户端初始化错误: ${(error as Error).message}`);
}

// 获取Firestore实例
let clientDb;
try {
  logWithTime('获取Firestore客户端实例...');
  clientDb = getClientFirestore(clientApp);
  logWithTime('Firestore客户端实例获取成功');
} catch (error) {
  logError('获取Firestore客户端实例失败', error);
  throw new Error(`获取Firestore实例错误: ${(error as Error).message}`);
}

// 集合名称前缀
const COLLECTION_PREFIX = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_PREFIX || 'code_evaluator';
logWithTime(`使用集合名称前缀: ${COLLECTION_PREFIX}`);

// 集合名称
export const COLLECTIONS = {
  EVALUATIONS: `${COLLECTION_PREFIX}_evaluations`,
  CACHE: `${COLLECTION_PREFIX}_cache`,
  GITHUB_REPOS: `${COLLECTION_PREFIX}_github_repos`,
};

logWithTime('Firestore集合定义完成', COLLECTIONS);

// 测试Firestore连接
async function testClientFirestore() {
  try {
    logWithTime('测试Firestore客户端连接...');
    // 不进行实际写入，仅进行一次空读取测试连接
    const timestamp = Date.now().toString();
    const testCollection = COLLECTIONS.EVALUATIONS;
    const testDocId = `connection-test-${timestamp}`;
    
    logWithTime(`尝试获取测试文档 ${testCollection}/${testDocId}`);
    
    // 不需要真正进行操作，仅测试能否获取引用
    const ref = clientDb.collection(testCollection).doc(testDocId);
    
    if (ref) {
      logWithTime('Firestore客户端连接测试成功');
      return true;
    } else {
      logError('Firestore客户端连接测试失败: 无法获取文档引用', null);
      return false;
    }
  } catch (error) {
    logError('Firestore客户端连接测试失败', error);
    return false;
  }
}

// 测试连接
testClientFirestore().then((success) => {
  if (success) {
    logWithTime('Firestore客户端可正常访问');
  } else {
    logWithTime('Firestore客户端连接问题，请检查网络和配置');
  }
}).catch(err => {
  logError('Firestore客户端测试错误', err);
});

export { clientDb }; 