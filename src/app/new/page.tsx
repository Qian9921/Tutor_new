'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function NewEvaluationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    githubRepoUrl: '',
    projectDetail: '',
    currentTask: '',
    subtasks: ['']
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // 添加子任务字段
  const addSubtask = () => {
    setFormData(prev => ({
      ...prev,
      subtasks: [...prev.subtasks, '']
    }));
  };

  // 移除子任务字段
  const removeSubtask = (index: number) => {
    if (formData.subtasks.length === 1) return;
    
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks.filter((_, i) => i !== index)
    }));
  };

  // 更新子任务值
  const updateSubtask = (index: number, value: string) => {
    setFormData(prev => {
      const newSubtasks = [...prev.subtasks];
      newSubtasks[index] = value;
      return {
        ...prev,
        subtasks: newSubtasks
      };
    });
  };

  // 表单字段更新
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // 清除该字段的验证错误
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = {...prev};
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // 验证表单
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!formData.githubRepoUrl.trim()) {
      errors.githubRepoUrl = 'GitHub仓库URL是必填的';
    } else if (!formData.githubRepoUrl.includes('github.com')) {
      errors.githubRepoUrl = 'GitHub仓库URL格式不正确';
    }
    
    if (!formData.projectDetail.trim()) {
      errors.projectDetail = '项目详情是必填的';
    }
    
    if (!formData.currentTask.trim()) {
      errors.currentTask = '当前任务是必填的';
    }
    
    let hasEmptySubtask = false;
    formData.subtasks.forEach((task, index) => {
      if (!task.trim()) {
        hasEmptySubtask = true;
        errors[`subtask-${index}`] = '子任务不能为空';
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // 提交表单
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('提交评估请求:', formData);
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '提交评估请求失败');
      }
      
      console.log('评估请求成功:', data);
      
      // 重定向到评估详情页
      if (data.evaluationId) {
        router.push(`/${data.evaluationId}`);
      }
    } catch (err) {
      console.error('提交评估失败:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
      <div className="w-full max-w-3xl">
        <div className="mb-8">
          <Link 
            href="/" 
            className="flex items-center text-blue-600 hover:text-blue-800 transition"
          >
            &larr; 返回首页
          </Link>
        </div>
        
        <div className="bg-white rounded-xl shadow-md overflow-hidden p-8 mb-6">
          <h1 className="text-3xl font-bold mb-6 text-center">创建新评估</h1>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg">
              <p className="font-medium">错误:</p>
              <p>{error}</p>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="githubRepoUrl" className="block text-gray-700 font-medium mb-2">
                GitHub 仓库 URL <span className="text-red-500">*</span>
              </label>
              <input
                id="githubRepoUrl"
                name="githubRepoUrl"
                type="text"
                value={formData.githubRepoUrl}
                onChange={handleInputChange}
                placeholder="例如: https://github.com/username/repo.git"
                className={`w-full p-3 border rounded-md ${validationErrors.githubRepoUrl ? 'border-red-500' : 'border-gray-300'}`}
              />
              {validationErrors.githubRepoUrl && (
                <p className="mt-1 text-sm text-red-500">{validationErrors.githubRepoUrl}</p>
              )}
              <p className="mt-1 text-sm text-gray-500">
                请输入完整的GitHub仓库URL，确保仓库可公开访问
              </p>
            </div>
            
            <div>
              <label htmlFor="projectDetail" className="block text-gray-700 font-medium mb-2">
                项目详情 <span className="text-red-500">*</span>
              </label>
              <textarea
                id="projectDetail"
                name="projectDetail"
                value={formData.projectDetail}
                onChange={handleInputChange}
                placeholder="描述项目的背景、目标和技术栈..."
                rows={3}
                className={`w-full p-3 border rounded-md ${validationErrors.projectDetail ? 'border-red-500' : 'border-gray-300'}`}
              ></textarea>
              {validationErrors.projectDetail && (
                <p className="mt-1 text-sm text-red-500">{validationErrors.projectDetail}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="currentTask" className="block text-gray-700 font-medium mb-2">
                当前任务 <span className="text-red-500">*</span>
              </label>
              <input
                id="currentTask"
                name="currentTask"
                type="text"
                value={formData.currentTask}
                onChange={handleInputChange}
                placeholder="当前正在进行的任务..."
                className={`w-full p-3 border rounded-md ${validationErrors.currentTask ? 'border-red-500' : 'border-gray-300'}`}
              />
              {validationErrors.currentTask && (
                <p className="mt-1 text-sm text-red-500">{validationErrors.currentTask}</p>
              )}
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-gray-700 font-medium">
                  子任务 <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={addSubtask}
                  className="text-sm py-1 px-3 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition"
                >
                  添加子任务
                </button>
              </div>
              
              <div className="space-y-3">
                {formData.subtasks.map((subtask, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={subtask}
                      onChange={(e) => updateSubtask(index, e.target.value)}
                      placeholder={`子任务 ${index + 1}`}
                      className={`flex-1 p-3 border rounded-md ${validationErrors[`subtask-${index}`] ? 'border-red-500' : 'border-gray-300'}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeSubtask(index)}
                      disabled={formData.subtasks.length === 1}
                      className="p-2 text-red-500 hover:text-red-700 disabled:text-gray-300"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              
              {Object.keys(validationErrors).some(key => key.startsWith('subtask-')) && (
                <p className="mt-1 text-sm text-red-500">所有子任务都不能为空</p>
              )}
            </div>
            
            <div className="flex justify-center pt-4">
              <button
                type="submit"
                disabled={loading}
                className="py-3 px-8 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
              >
                {loading ? '提交中...' : '提交评估请求'}
              </button>
            </div>
          </form>
        </div>
        
        <div className="bg-blue-50 p-6 rounded-xl">
          <h2 className="text-lg font-semibold mb-2 text-blue-800">评估说明</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-600">
            <li>评估过程包括获取仓库代码、分析代码结构和内容、生成评估报告</li>
            <li>整个过程可能需要几分钟时间，请耐心等待</li>
            <li>评估结果将包含代码质量、功能实现、可维护性和安全性等方面的评分</li>
            <li>系统会根据当前任务自动提取最相关的代码文件进行分析</li>
            <li>评估完成后，您可以在评估历史中查看结果</li>
          </ul>
        </div>
      </div>
    </main>
  );
} 