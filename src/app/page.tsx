import Link from 'next/link';
import { Suspense } from 'react';
import RecentEvaluations from '@/components/RecentEvaluations';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col items-center mb-12 text-center">
          <h1 className="text-4xl font-bold mb-4 text-gray-800">
            代码评估平台
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            基于LlamaIndex和豆包API的项目代码智能评估系统
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl">
            <Link 
              href="/test" 
              className="flex items-center justify-center p-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
            >
              测试系统连通性
            </Link>
            <Link 
              href="/new" 
              className="flex items-center justify-center p-4 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition"
            >
              创建新评估
            </Link>
            <Link 
              href="/history" 
              className="flex items-center justify-center p-4 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition"
            >
              查看历史评估
            </Link>
          </div>
        </div>

        <div className="w-full bg-white rounded-xl shadow-md overflow-hidden p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">系统概览</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-medium text-blue-800">GitHub 集成</h3>
              <p className="text-gray-600">自动获取仓库完整代码，支持缓存</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-medium text-green-800">LlamaIndex 处理</h3>
              <p className="text-gray-600">提取关键文件，分析项目结构</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-medium text-purple-800">豆包 AI 评估</h3>
              <p className="text-gray-600">专业代码品质评估，提供改进建议</p>
            </div>
          </div>
        </div>

        <div className="w-full bg-white rounded-xl shadow-md overflow-hidden p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold text-gray-800">最近评估</h2>
            <Link 
              href="/history" 
              className="text-blue-600 hover:text-blue-800 transition"
            >
              查看全部
            </Link>
          </div>
          
          <Suspense fallback={<div className="text-center py-8">加载中...</div>}>
            <RecentEvaluations />
          </Suspense>
        </div>

        <div className="mt-12 text-center text-gray-500 text-sm">
          <p>API文档: POST /api/evaluate 接受评估请求</p>
          <p>GET /api/status/{'{id}'} 获取评估状态</p>
          <p>测试页面: <Link href="/test" className="text-blue-500 hover:underline">/test</Link></p>
        </div>
      </div>
    </main>
  );
}
