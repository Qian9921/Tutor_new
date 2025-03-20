'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// 评估类型
interface Evaluation {
  id: string;
  status: string;
  projectDetail: string;
  currentTask: string;
  createdAt: string | Date;
  result?: any;
}

export default function RecentEvaluations() {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvaluations() {
      try {
        const response = await fetch('/api/evaluations');
        if (!response.ok) {
          throw new Error(`获取评估失败: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        // 只取前5条记录
        setEvaluations(data.evaluations?.slice(0, 5) || []);
        setLoading(false);
      } catch (err) {
        console.error('获取最近评估错误:', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    fetchEvaluations();
  }, []);

  // 渲染评估状态标签
  function getStatusBadge(status: string) {
    switch (status) {
      case 'completed':
        return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">已完成</span>;
      case 'pending':
        return <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">等待中</span>;
      case 'processing_repo':
        return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">处理仓库</span>;
      case 'evaluating':
        return <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">评估中</span>;
      case 'failed':
        return <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">失败</span>;
      default:
        return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs">{status}</span>;
    }
  }

  // 格式化日期
  function formatDate(date: string | Date | null) {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="p-4 border rounded-lg">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50">
        <p className="text-red-500">获取评估记录失败: {error}</p>
      </div>
    );
  }

  if (evaluations.length === 0) {
    return (
      <div className="p-6 border border-gray-200 rounded-lg text-center">
        <p className="text-gray-500">暂无评估记录</p>
        <Link 
          href="/new" 
          className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          创建评估
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {evaluations.map((evaluation) => (
        <div key={evaluation.id} className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition">
          <div className="flex justify-between items-start mb-2">
            <Link 
              href={`/detail/${evaluation.id}`}
              className="text-lg font-medium text-blue-600 hover:underline"
            >
              {evaluation.currentTask || '未命名评估'}
            </Link>
            {getStatusBadge(evaluation.status)}
          </div>
          
          <p className="text-gray-500 mb-2 text-sm line-clamp-2">
            {evaluation.projectDetail || '无项目详情'}
          </p>
          
          <div className="flex justify-between items-center text-sm mt-3">
            <span className="text-gray-500">
              {formatDate(evaluation.createdAt)}
            </span>
            
            {evaluation.status === 'completed' && evaluation.result && (
              <span className="font-bold text-blue-600">
                {evaluation.result.overall}/10
              </span>
            )}
          </div>
        </div>
      ))}
      
      <div className="mt-4 text-center">
        <Link 
          href="/history" 
          className="text-blue-600 hover:underline text-sm"
        >
          查看所有评估 &rarr;
        </Link>
      </div>
    </div>
  );
} 