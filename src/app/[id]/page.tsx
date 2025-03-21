'use client';
export const runtime = 'edge';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// 评估状态类型
type EvaluationStatus = 'pending' | 'processing_repo' | 'evaluating' | 'completed' | 'failed';

// 评估结果类型
interface EvaluationResult {
  overall: number;
  quality: number;
  functionality: number;
  maintainability: number;
  security: number;
  comments: string;
  suggestions: string[];
  timestamp: string;
}

// 评估数据类型
interface EvaluationData {
  id: string;
  status: EvaluationStatus;
  statusMessage?: string;
  projectDetail?: string;
  currentTask?: string;
  githubRepoUrl?: string;
  repoSummary?: string;
  result?: EvaluationResult;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export default function EvaluationDetail() {
  const params = useParams();
  const id = params.id as string;
  
  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // 轮询状态
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    const fetchEvaluation = async () => {
      try {
        const response = await fetch(`/api/status/${id}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '获取评估状态失败');
        }
        
        const data = await response.json();
        setEvaluation(data.evaluation);
        setLoading(false);
        
        // 如果评估已完成或失败，停止轮询
        if (data.evaluation.status === 'completed' || data.evaluation.status === 'failed') {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError((err as Error).message);
        setLoading(false);
        clearInterval(intervalId);
      }
    };
    
    // 立即获取一次
    fetchEvaluation();
    
    // 设置轮询（如果不是服务器端）
    if (typeof window !== 'undefined') {
      intervalId = setInterval(fetchEvaluation, 5000); // 每5秒轮询一次
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [id]);
  
  // 渲染评估状态标签
  const renderStatusBadge = (status: EvaluationStatus) => {
    const badgeClasses = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing_repo: 'bg-blue-100 text-blue-800',
      evaluating: 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    };
    
    const statusLabels = {
      pending: '待处理',
      processing_repo: '获取仓库中',
      evaluating: '评估中',
      completed: '已完成',
      failed: '失败'
    };
    
    return (
      <span className={`inline-block px-3 py-1 rounded-full font-medium text-sm ${badgeClasses[status]}`}>
        {statusLabels[status]}
      </span>
    );
  };
  
  // 渲染进度条
  const renderProgressBar = (status: EvaluationStatus) => {
    const progressSteps = ['pending', 'processing_repo', 'evaluating', 'completed'];
    const currentStepIndex = progressSteps.indexOf(status);
    const progress = status === 'failed' ? 0 : Math.round((currentStepIndex / (progressSteps.length - 1)) * 100);
    
    return (
      <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
        <div 
          className={`h-2 rounded-full ${status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`} 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    );
  };
  
  // 渲染评分卡片
  const renderScoreCard = (label: string, score: number, description: string) => {
    const getScoreColor = (score: number) => {
      if (score >= 8) return 'text-green-600';
      if (score >= 6) return 'text-blue-600';
      if (score >= 4) return 'text-yellow-600';
      return 'text-red-600';
    };
    
    return (
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-medium text-gray-700">{label}</h3>
          <span className={`text-xl font-bold ${getScoreColor(score)}`}>{score}</span>
        </div>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    );
  };
  
  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
        <div className="w-full max-w-4xl">
          <div className="mb-8">
            <Link 
              href="/" 
              className="flex items-center text-blue-600 hover:text-blue-800 transition"
            >
              &larr; 返回首页
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-md overflow-hidden p-8 text-center">
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-3/4 mx-auto mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto mb-6"></div>
              <div className="h-40 bg-gray-200 rounded w-full mb-6"></div>
              <div className="h-6 bg-gray-200 rounded w-1/4 mx-auto"></div>
            </div>
            <p className="mt-6 text-gray-500">正在加载评估数据...</p>
          </div>
        </div>
      </main>
    );
  }
  
  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
        <div className="w-full max-w-4xl">
          <div className="mb-8">
            <Link 
              href="/" 
              className="flex items-center text-blue-600 hover:text-blue-800 transition"
            >
              &larr; 返回首页
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-md overflow-hidden p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">发生错误</h1>
            <div className="p-4 bg-red-50 text-red-700 rounded-lg mb-6">
              {error}
            </div>
            <Link 
              href="/" 
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition inline-block"
            >
              返回首页
            </Link>
          </div>
        </div>
      </main>
    );
  }
  
  if (!evaluation) {
    return (
      <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
        <div className="w-full max-w-4xl">
          <div className="mb-8">
            <Link 
              href="/" 
              className="flex items-center text-blue-600 hover:text-blue-800 transition"
            >
              &larr; 返回首页
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-md overflow-hidden p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">未找到评估</h1>
            <p className="text-gray-600 mb-6">找不到ID为 {id} 的评估记录</p>
            <Link 
              href="/new" 
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition inline-block"
            >
              创建新评估
            </Link>
          </div>
        </div>
      </main>
    );
  }
  
  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
      <div className="w-full max-w-4xl">
        <div className="mb-8">
          <Link 
            href="/" 
            className="flex items-center text-blue-600 hover:text-blue-800 transition"
          >
            &larr; 返回首页
          </Link>
        </div>
        
        <div className="bg-white rounded-xl shadow-md overflow-hidden p-8 mb-8">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-3xl font-bold text-gray-800">代码评估详情</h1>
            {renderStatusBadge(evaluation.status)}
          </div>
          
          {renderProgressBar(evaluation.status)}
          
          {evaluation.statusMessage && (
            <p className="text-gray-600 mb-6">{evaluation.statusMessage}</p>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">项目信息</h2>
              <div className="space-y-2">
                <p><span className="font-medium">项目ID:</span> {evaluation.id}</p>
                <p><span className="font-medium">创建时间:</span> {new Date(evaluation.createdAt).toLocaleString()}</p>
                {evaluation.completedAt && (
                  <p><span className="font-medium">完成时间:</span> {new Date(evaluation.completedAt).toLocaleString()}</p>
                )}
              </div>
            </div>
            
            <div>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">评估任务</h2>
              <div className="space-y-2">
                {evaluation.projectDetail && (
                  <p><span className="font-medium">项目详情:</span> {evaluation.projectDetail}</p>
                )}
                {evaluation.currentTask && (
                  <p><span className="font-medium">当前任务:</span> {evaluation.currentTask}</p>
                )}
                {evaluation.githubRepoUrl && (
                  <p>
                    <span className="font-medium">GitHub仓库:</span>{' '}
                    <a 
                      href={evaluation.githubRepoUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {evaluation.githubRepoUrl}
                    </a>
                  </p>
                )}
              </div>
            </div>
          </div>
          
          {evaluation.status === 'failed' && evaluation.error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg mb-6">
              <h3 className="font-medium mb-2">评估失败</h3>
              <p>{evaluation.error}</p>
            </div>
          )}
          
          {evaluation.repoSummary && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-3 text-gray-800">仓库概述</h2>
              <div className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap font-mono text-sm">
                {evaluation.repoSummary}
              </div>
            </div>
          )}
          
          {evaluation.result && (
            <div>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">评估结果</h2>
              
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">总体评分</h3>
                  <span className="text-3xl font-bold text-blue-600">{evaluation.result.overall}/10</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="h-3 rounded-full bg-blue-600" 
                    style={{ width: `${evaluation.result.overall * 10}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {renderScoreCard('代码质量', evaluation.result.quality, '代码风格、可读性、一致性')}
                {renderScoreCard('功能实现', evaluation.result.functionality, '功能完成度、正确性')}
                {renderScoreCard('可维护性', evaluation.result.maintainability, '架构设计、可扩展性')}
                {renderScoreCard('安全性', evaluation.result.security, '安全风险、漏洞防范')}
              </div>
              
              <div className="mb-6">
                <h3 className="font-medium mb-3">详细评论</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="whitespace-pre-wrap">{evaluation.result.comments}</p>
                </div>
              </div>
              
              <div>
                <h3 className="font-medium mb-3">改进建议</h3>
                <ul className="list-disc pl-6 space-y-2">
                  {evaluation.result.suggestions.map((suggestion, index) => (
                    <li key={index} className="text-gray-700">{suggestion}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex justify-between">
          <Link 
            href="/" 
            className="px-6 py-3 bg-gray-200 text-gray-800 font-medium rounded-lg hover:bg-gray-300 transition"
          >
            返回首页
          </Link>
          
          <Link 
            href="/new" 
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
          >
            创建新评估
          </Link>
        </div>
      </div>
    </main>
  );
} 