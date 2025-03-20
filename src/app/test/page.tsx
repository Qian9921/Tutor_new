'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// 调试日志组件
const DebugLogs = ({ logs }: { logs: string[] }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);
  
  return (
    <div className="bg-gray-900 text-green-400 p-4 rounded-md font-mono text-sm mt-4 max-h-96 overflow-auto">
      {logs.map((log, index) => (
        <div key={index} className="pb-1">
          {log}
        </div>
      ))}
      <div ref={logsEndRef} />
    </div>
  );
};

export default function TestPage() {
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState('https://github.com/facebookresearch/llama');
  const [debugMode, setDebugMode] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [requestStatus, setRequestStatus] = useState<string>('');

  const addDebugLog = (message: string) => {
    setDebugLogs(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
  };

  const clearDebugLogs = () => {
    setDebugLogs([]);
  };

  // 运行GET测试
  const runTest = async () => {
    setLoading(true);
    setTestResults(null);
    setError(null);
    setRequestStatus('running');
    
    if (debugMode) {
      clearDebugLogs();
      addDebugLog('开始运行连接测试...');
    }

    try {
      if (debugMode) addDebugLog('构建API URL: /api/test');
      const response = await fetch('/api/test', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (debugMode) addDebugLog(`收到响应状态: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        if (debugMode) addDebugLog(`错误响应内容: ${errorText}`);
        throw new Error(`API错误: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (debugMode) addDebugLog('解析响应JSON...');
      const data = await response.json();
      
      if (debugMode) {
        addDebugLog('响应解析成功');
        addDebugLog(`Firebase连接: ${data.firebase ? '成功' : '失败'}`);
        addDebugLog(`GitHub API: ${data.github ? '成功' : '失败'}`);
        addDebugLog(`LlamaIndex: ${data.llamaindex ? '成功' : '失败'}`);
        addDebugLog(`Doubao API: ${data.doubao ? '成功' : '失败'}`);
      }
      
      setTestResults(data);
      setRequestStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (debugMode) addDebugLog(`测试失败: ${errorMessage}`);
      setError(errorMessage);
      setRequestStatus('error');
    } finally {
      setLoading(false);
      if (debugMode) addDebugLog('测试完成');
    }
  };

  // 运行POST测试
  const runPostTest = async () => {
    setLoading(true);
    setTestResults(null);
    setError(null);
    setRequestStatus('running');
    
    if (debugMode) {
      clearDebugLogs();
      addDebugLog('开始运行评估流程测试...');
    }

    try {
      if (!githubRepoUrl) {
        throw new Error('请输入GitHub仓库URL');
      }

      if (debugMode) addDebugLog(`准备请求数据，GitHub URL: ${githubRepoUrl}`);
      
      const requestData = {
        projectDetail: '测试项目详情',
        subtasks: ['测试子任务1', '测试子任务2'],
        currentTask: '测试当前任务',
        githubRepoUrl: githubRepoUrl
      };
      
      if (debugMode) addDebugLog(`发送POST请求到 /api/test`);
      
      const response = await fetch('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(requestData)
      });
      
      if (debugMode) addDebugLog(`收到响应状态: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        if (debugMode) addDebugLog(`错误响应内容: ${errorText}`);
        throw new Error(`API错误: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (debugMode) addDebugLog('解析响应JSON...');
      const data = await response.json();
      
      if (debugMode) {
        addDebugLog('评估请求提交成功');
        if (data.apiResponse?.evaluationId) {
          addDebugLog(`评估ID: ${data.apiResponse.evaluationId}`);
        } else {
          addDebugLog('警告: 响应中没有找到evaluationId');
        }
      }
      
      setTestResults(data);
      setRequestStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (debugMode) addDebugLog(`评估测试失败: ${errorMessage}`);
      setError(errorMessage);
      setRequestStatus('error');
    } finally {
      setLoading(false);
      if (debugMode) addDebugLog('评估测试完成');
    }
  };
  
  // 详细调试模式的POST测试
  const runDebugPostTest = async () => {
    setLoading(true);
    setTestResults(null);
    setError(null);
    setRequestStatus('running');
    clearDebugLogs();
    
    addDebugLog('🔍 开始详细调试评估流程...');
    
    try {
      // 步骤1: 验证输入
      addDebugLog('步骤1: 验证GitHub URL');
      if (!githubRepoUrl) {
        addDebugLog('❌ GitHub URL为空');
        throw new Error('请输入GitHub仓库URL');
      }
      addDebugLog(`✅ GitHub URL有效: ${githubRepoUrl}`);
      
      // 步骤2: 准备请求数据
      addDebugLog('步骤2: 准备请求数据');
      const requestData = {
        projectDetail: '测试项目详情',
        subtasks: ['测试子任务1', '测试子任务2'],
        currentTask: '测试当前任务',
        githubRepoUrl: githubRepoUrl
      };
      addDebugLog(`✅ 请求数据已准备: ${JSON.stringify(requestData)}`);
      
      // 步骤3: 构建API URL
      addDebugLog('步骤3: 构建API URL');
      const apiUrl = '/api/test';
      addDebugLog(`✅ API URL: ${apiUrl}`);
      
      // 步骤4: 发送请求
      addDebugLog('步骤4: 发送POST请求');
      addDebugLog(`发送请求体: ${JSON.stringify(requestData)}`);
      addDebugLog(`Headers: Content-Type: application/json, Cache-Control: no-cache`);
      
      try {
        const startTime = Date.now();
        addDebugLog(`⏱️ 开始时间: ${new Date(startTime).toISOString()}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify(requestData)
        });
        
        const endTime = Date.now();
        addDebugLog(`⏱️ 结束时间: ${new Date(endTime).toISOString()}`);
        addDebugLog(`⏱️ 请求耗时: ${endTime - startTime}ms`);
        
        // 步骤5: 检查响应状态
        addDebugLog('步骤5: 检查响应状态');
        addDebugLog(`响应状态: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          addDebugLog(`❌ 响应状态码表示错误: ${response.status}`);
          try {
            const errorText = await response.text();
            addDebugLog(`错误响应内容: ${errorText}`);
            throw new Error(`API错误: ${response.status} ${response.statusText} - ${errorText}`);
          } catch (textError) {
            addDebugLog(`❌ 无法读取错误响应内容: ${textError instanceof Error ? textError.message : String(textError)}`);
            throw new Error(`API错误: ${response.status} ${response.statusText} - 无法读取响应内容`);
          }
        }
        
        addDebugLog(`✅ 响应状态码正常: ${response.status}`);
        
        // 步骤6: 读取响应内容
        addDebugLog('步骤6: 读取响应内容');
        let responseText;
        try {
          responseText = await response.text();
          addDebugLog(`收到响应内容 (${responseText.length} 字符)`);
          if (responseText.length > 500) {
            addDebugLog(`响应内容太长，仅显示前500字符: ${responseText.substring(0, 500)}...`);
          } else {
            addDebugLog(`响应内容: ${responseText}`);
          }
        } catch (textError) {
          addDebugLog(`❌ 无法读取响应内容: ${textError instanceof Error ? textError.message : String(textError)}`);
          throw new Error('无法读取API响应内容');
        }
        
        // 步骤7: 解析JSON
        addDebugLog('步骤7: 解析JSON响应');
        let data;
        try {
          data = JSON.parse(responseText);
          addDebugLog(`✅ JSON解析成功`);
        } catch (jsonError) {
          addDebugLog(`❌ JSON解析失败: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`);
          addDebugLog(`无效的JSON内容: ${responseText}`);
          throw new Error('API返回了无效的JSON响应');
        }
        
        // 步骤8: 验证响应数据
        addDebugLog('步骤8: 验证响应数据');
        if (!data.success) {
          addDebugLog(`❌ 响应表示操作失败: ${data.message || 'Unknown error'}`);
          throw new Error(`API响应表示失败: ${data.message || 'Unknown error'}`);
        }
        
        addDebugLog(`✅ API操作成功: ${data.message || 'Success'}`);
        
        // 检查评估ID
        if (data.apiResponse?.evaluationId) {
          addDebugLog(`✅ 收到评估ID: ${data.apiResponse.evaluationId}`);
        } else {
          addDebugLog(`⚠️ 警告: 响应中没有找到evaluationId`);
        }
        
        // 步骤9: 设置结果
        addDebugLog('步骤9: 设置UI结果');
        setTestResults(data);
        setRequestStatus('success');
        addDebugLog('✅ 测试结果已更新到UI');
        
      } catch (fetchError) {
        addDebugLog(`❌ 请求过程中发生错误: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        throw fetchError;
      }
      
    } catch (err) {
      addDebugLog(`❌ 测试失败: ${err instanceof Error ? err.message : String(err)}`);
      setError(err instanceof Error ? err.message : String(err));
      setRequestStatus('error');
    } finally {
      setLoading(false);
      addDebugLog('🏁 详细调试评估流程结束');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">系统测试页面</h1>
        <nav className="mb-4">
          <ul className="flex space-x-4">
            <li>
              <Link href="/" className="text-blue-500 hover:underline">
                首页
              </Link>
            </li>
            <li>
              <Link href="/dashboard" className="text-blue-500 hover:underline">
                控制台
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* 系统连接测试部分 */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">系统连接测试</h2>
          <p className="mb-4 text-gray-600">
            测试系统各组件连接状态，包括Firebase、GitHub API和LlamaIndex。
          </p>
          
          <div className="mb-4">
            <button
              onClick={runTest}
              disabled={loading}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
              {loading && requestStatus === 'running' ? '测试中...' : '运行连接测试'}
            </button>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p>{error}</p>
            </div>
          )}

          {testResults && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">测试结果:</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li className={testResults.firebase ? 'text-green-600' : 'text-red-600'}>
                  Firebase连接: {testResults.firebase ? '成功' : '失败'}
                  {testResults.firebaseError && <p className="text-red-500 text-sm">{testResults.firebaseError}</p>}
                </li>
                <li className={testResults.github ? 'text-green-600' : 'text-red-600'}>
                  GitHub API: {testResults.github ? '成功' : '失败'}
                  {testResults.githubError && <p className="text-red-500 text-sm">{testResults.githubError}</p>}
                </li>
                <li className={testResults.llamaindex ? 'text-green-600' : 'text-red-600'}>
                  LlamaIndex: {testResults.llamaindex ? '成功' : '失败'}
                  {testResults.llamaindexError && <p className="text-red-500 text-sm">{testResults.llamaindexError}</p>}
                </li>
                <li className={testResults.doubao ? 'text-green-600' : 'text-red-600'}>
                  Doubao API: {testResults.doubao ? '成功' : '失败'}
                  {testResults.doubaoError && <p className="text-red-500 text-sm">{testResults.doubaoError}</p>}
                </li>
              </ul>
            </div>
          )}
        </section>

        {/* 评估流程测试部分 */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">评估流程测试</h2>
          <p className="mb-4 text-gray-600">
            测试完整评估流程，包括GitHub代码获取、LlamaIndex处理和Doubao API评估。
          </p>
          
          <div className="mb-4">
            <label className="block text-gray-700 mb-2">GitHub仓库URL:</label>
            <input
              type="text"
              value={githubRepoUrl}
              onChange={(e) => setGithubRepoUrl(e.target.value)}
              placeholder="输入GitHub仓库URL"
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          
          <div className="flex space-x-2 mb-4">
            <button
              onClick={runPostTest}
              disabled={loading}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-400"
            >
              {loading && requestStatus === 'running' ? '测试中...' : '提交测试'}
            </button>
            
            {debugMode && (
              <button
                onClick={runDebugPostTest}
                disabled={loading}
                className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:bg-gray-400"
              >
                {loading && requestStatus === 'running' ? '调试中...' : '调试提交'}
              </button>
            )}
          </div>
          
          <div className="mb-4">
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={() => setDebugMode(!debugMode)}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span className="ml-2 text-gray-700">显示调试日志</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p>{error}</p>
            </div>
          )}

          {testResults && testResults.apiResponse && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">评估请求结果:</h3>
              <div className="bg-gray-100 p-3 rounded">
                <p><span className="font-medium">状态:</span> {testResults.success ? '成功' : '失败'}</p>
                {testResults.apiResponse.evaluationId && (
                  <p><span className="font-medium">评估ID:</span> {testResults.apiResponse.evaluationId}</p>
                )}
                {testResults.message && (
                  <p><span className="font-medium">消息:</span> {testResults.message}</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      
      {/* 调试日志部分 */}
      {debugMode && debugLogs.length > 0 && (
        <section className="mt-8">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-lg font-semibold">调试日志</h3>
            <button 
              onClick={clearDebugLogs}
              className="text-red-500 hover:text-red-700 text-sm"
            >
              清除日志
            </button>
          </div>
          <DebugLogs logs={debugLogs} />
        </section>
      )}
    </div>
  );
}