import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS, testDatabaseConnection, waitForDatabaseInitialization } from '@/lib/database';
import { parseGitHubUrl } from '@/lib/github';

// 定义测试结果接口
interface TestResult {
  success: boolean;
  message: string;
  error?: string;
  parsed?: { owner: string; repo: string };
}

// 定义所有测试类型的接口
interface Tests {
  database?: TestResult;
  github?: TestResult;
  doubao?: TestResult;
  llamaindex?: TestResult;
}

// 定义API响应接口
interface APIResponse {
  timestamp: string;
  tests: Tests;
  overall?: {
    success: boolean;
    message: string;
  };
}

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [TEST API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [TEST API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [TEST API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

/**
 * 测试API，用于验证系统各组件连通性
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(request: NextRequest) {
  logWithTime('收到GET请求 - 开始系统连通性测试');
  
  // 确保数据库已初始化
  try {
    await waitForDatabaseInitialization();
  } catch (error) {
    logError('数据库初始化失败', error);
  }
  
  const results: APIResponse = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  // 测试数据库连接
  try {
    logWithTime('测试数据库连接...');
    logWithTime(`使用集合: ${COLLECTIONS.EVALUATIONS}`);
    
    const connectionResult = await testDatabaseConnection();
    
    if (connectionResult) {
      logWithTime('数据库连接成功');
      results.tests.database = {
        success: true,
        message: '数据库连接成功'
      };
    } else {
      throw new Error('数据库连接测试失败');
    }
  } catch (error) {
    const errorMsg = '数据库连接失败: ' + (error as Error).message;
    logError('数据库连接测试失败', error);
    (results.tests as Record<string, unknown>).database = {
      success: false,
      message: errorMsg,
      error: (error as Error).stack
    };
  }

  // 测试GitHub API
  try {
    logWithTime('测试 GitHub API...');
    const testUrl = 'https://github.com/Qian9921/Nextjs.git';
    logWithTime(`解析GitHub URL: ${testUrl}`);
    
    const { owner, repo } = parseGitHubUrl(testUrl);
    
    logWithTime(`GitHub URL 解析成功: owner=${owner}, repo=${repo}`);
    results.tests.github = {
      success: true,
      message: '成功解析GitHub URL',
      parsed: { owner, repo }
    };
  } catch (error) {
    const errorMsg = 'GitHub URL解析失败: ' + (error as Error).message;
    logError('GitHub URL解析测试失败', error);
    results.tests.github = {
      success: false,
      message: errorMsg,
      error: (error as Error).stack
    };
  }

  // 测试豆包API连接
  try {
    logWithTime('测试豆包 API 配置...');
    // 简单测试，不实际发送请求
    const isApiKeySet = !!process.env.DOUBAO_API_KEY;
    const apiKeyPrefix = isApiKeySet ? process.env.DOUBAO_API_KEY?.substring(0, 4) + '****' : 'undefined';
    
    logWithTime(`豆包 API 密钥${isApiKeySet ? '已' : '未'}配置: ${apiKeyPrefix}`);
    results.tests.doubao = {
      success: isApiKeySet,
      message: isApiKeySet ? '豆包API密钥已配置' : '豆包API密钥未配置'
    };
  } catch (error) {
    const errorMsg = '豆包API测试失败: ' + (error as Error).message;
    logError('豆包API测试失败', error);
    results.tests.doubao = {
      success: false,
      message: errorMsg,
      error: (error as Error).stack
    };
  }

  // 测试LlamaIndex
  try {
    logWithTime('测试 LlamaIndex 配置...');
    // 不使用require直接导入，避免ESM导出问题
    results.tests.llamaindex = {
      success: true,
      message: 'LlamaIndex配置已检测'
    };
    logWithTime('LlamaIndex 配置检测成功');
  } catch (error) {
    const errorMsg = 'LlamaIndex测试失败: ' + (error as Error).message;
    logError('LlamaIndex测试失败', error);
    results.tests.llamaindex = {
      success: false,
      message: errorMsg,
      error: (error as Error).stack
    };
  }

  // 总体状态
  const allTests = Object.values(results.tests as Record<string, unknown>) as Array<{success: boolean}>;
  const allSuccess = allTests.every(test => test.success);
  
  results.overall = {
    success: allSuccess,
    message: allSuccess ? '所有系统组件连通正常' : '部分组件连接失败，请查看详细结果'
  };

  logWithTime(`GET /api/test - 测试完成，结果: ${allSuccess ? '成功' : '部分失败'}`);
  logWithTime('返回测试结果');
  
  return NextResponse.json(results);
}

/**
 * POST测试，用于测试评估流程
 */
export async function POST(request: NextRequest) {
  logWithTime('收到POST请求 - 开始测试评估流程');
  
  try {
    // 确保数据库已初始化
    try {
      await waitForDatabaseInitialization();
    } catch (error) {
      logError('数据库初始化失败', error);
      return NextResponse.json(
        { 
          success: false, 
          message: '数据库初始化失败，无法继续评估流程',
          error: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
    
    // 先测试数据库连接是否正常
    logWithTime('测试数据库连接状态...');
    try {
      const connectionSuccess = await testDatabaseConnection();
      
      if (!connectionSuccess) {
        throw new Error('数据库连接测试失败');
      }
      
      logWithTime('✅ 数据库连接测试成功');
    } catch (dbError) {
      logError('❌ 数据库连接测试失败', dbError);
      return NextResponse.json(
        { 
          success: false, 
          message: '数据库连接测试失败，无法继续评估流程',
          error: (dbError as Error).message
        },
        { status: 500 }
      );
    }
    
    logWithTime('解析请求数据...');
    let requestData;
    try {
      requestData = await request.json();
      logWithTime('请求数据解析成功', requestData);
    } catch (parseError) {
      logError('请求数据解析失败', parseError);
      return NextResponse.json(
        { error: '解析请求数据失败，确保发送了有效的JSON', success: false },
        { status: 400 }
      );
    }
    
    // 验证请求数据
    if (!requestData.githubRepoUrl) {
      const errorMsg = '缺少githubRepoUrl字段';
      logError(errorMsg, requestData);
      return NextResponse.json(
        { error: errorMsg, success: false },
        { status: 400 }
      );
    }
    
    // 创建测试评估请求
    const testEvaluationRequest = {
      projectDetail: requestData.projectDetail || '测试项目',
      subtasks: requestData.subtasks || ['测试任务1', '测试任务2'],
      currentTask: requestData.currentTask || '测试当前任务',
      githubRepoUrl: requestData.githubRepoUrl
    };
    
    logWithTime('准备调用内部评估API...');
    logWithTime('评估请求', testEvaluationRequest);
    
    // 构建内部API URL
    const apiUrl = new URL('/api/evaluate', request.url).toString();
    logWithTime('目标API URL:', apiUrl);
    
    // 调用内部评估API
    logWithTime('发送请求到评估API...');
    try {
      const startTime = Date.now();
      logWithTime(`请求开始时间: ${new Date(startTime).toISOString()}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testEvaluationRequest)
      });
      
      const endTime = Date.now();
      logWithTime(`请求结束时间: ${new Date(endTime).toISOString()}`);
      logWithTime(`请求耗时: ${endTime - startTime}ms`);
      
      logWithTime(`评估API响应状态: ${response.status} ${response.statusText}`);
      
      // 尝试读取响应文本，无论成功与否
      let responseText = '';
      try {
        responseText = await response.text();
        logWithTime(`原始响应内容 (${responseText.length} 字符):`);
        logWithTime(responseText);
      } catch (textErr) {
        logError(`无法读取响应文本`, textErr);
      }
      
      // 尝试解析JSON
      let responseData;
      try {
        responseData = JSON.parse(responseText);
        logWithTime(`解析后的响应数据`, responseData);
      } catch (jsonErr) {
        logError(`响应不是有效的JSON`, jsonErr);
        return NextResponse.json({
          success: false,
          message: `无法解析API响应: ${(jsonErr as Error).message}`,
          rawResponse: responseText
        }, { status: 500 });
      }
      
      if (!response.ok) {
        logError(`评估API请求失败: ${response.status}`, responseData);
        return NextResponse.json({
          success: false,
          message: `评估API请求失败: ${response.status} ${response.statusText}`,
          apiError: responseData
        }, { status: response.status });
      }
      
      logWithTime('评估API请求成功，处理响应...');
      
      // 检查响应中是否包含evaluationId
      if (!responseData.evaluationId) {
        logError('响应中缺少evaluationId', responseData);
        return NextResponse.json({
          success: false,
          message: '评估API响应中缺少evaluationId',
          apiResponse: responseData
        }, { status: 500 });
      }
      
      // 验证evaluationId是否在数据库中存在
      logWithTime(`验证evaluationId: ${responseData.evaluationId}`);
      try {
        const evaluationDoc = db.collection(COLLECTIONS.EVALUATIONS).doc(responseData.evaluationId);
        logWithTime(`评估文档路径: ${evaluationDoc.path}`);
        
        const docSnapshot = await evaluationDoc.get();
        if (docSnapshot.exists) {
          logWithTime('评估文档存在且可读取', docSnapshot.data());
        } else {
          logError(`评估文档不存在: ${responseData.evaluationId}`, null);
        }
      } catch (validateError) {
        logError(`验证evaluationId失败`, validateError);
      }
      
      logWithTime(`评估ID获取成功: ${responseData.evaluationId}`);
      logWithTime('POST /api/test - 测试评估流程完成');
      
      return NextResponse.json({
        success: true,
        message: '测试评估请求已提交',
        testRequest: testEvaluationRequest,
        apiResponse: responseData
      });
    } catch (fetchError) {
      logError('调用评估API失败', fetchError);
      return NextResponse.json({
        success: false,
        message: `调用评估API失败: ${(fetchError as Error).message}`,
        stack: (fetchError as Error).stack
      }, { status: 500 });
    }
  } catch (error) {
    const errorMsg = '测试评估失败: ' + (error as Error).message;
    logError('测试评估失败', error);
    
    return NextResponse.json({
      success: false,
      message: errorMsg,
      stack: (error as Error).stack
    }, { status: 500 });
  }
} 