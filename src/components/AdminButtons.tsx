'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function AdminButtons() {
  const [isLoading, setIsLoading] = useState({
    clearCache: false,
    resetDatabase: false
  });

  // 清除缓存
  const handleClearCache = async () => {
    if (confirm('确定要清除所有缓存数据吗？')) {
      try {
        setIsLoading(prev => ({ ...prev, clearCache: true }));
        const response = await fetch('/api/admin/clear-cache', {
          method: 'POST',
        });
        const data = await response.json();
        if (data.success) {
          alert('缓存已成功清除！');
        } else {
          alert(`清除缓存失败: ${data.message}`);
        }
      } catch (error) {
        alert(`清除缓存时发生错误: ${error}`);
      } finally {
        setIsLoading(prev => ({ ...prev, clearCache: false }));
      }
    }
  };

  // 重置数据库
  const handleResetDatabase = async () => {
    if (confirm('警告：此操作将删除所有数据库表并重新创建！确定要继续吗？')) {
      if (confirm('再次确认：此操作不可撤销，所有数据将丢失！确定要继续吗？')) {
        try {
          setIsLoading(prev => ({ ...prev, resetDatabase: true }));
          const response = await fetch('/api/admin/reset-database', {
            method: 'POST',
          });
          const data = await response.json();
          if (data.success) {
            alert('数据库已成功重置！');
          } else {
            alert(`重置数据库失败: ${data.message}`);
          }
        } catch (error) {
          alert(`重置数据库时发生错误: ${error}`);
        } finally {
          setIsLoading(prev => ({ ...prev, resetDatabase: false }));
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mt-4">
      <Link 
        href="/database-view" 
        className="flex items-center justify-center p-4 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition"
      >
        数据库可视化
      </Link>
      <button 
        onClick={handleClearCache}
        disabled={isLoading.clearCache}
        className={`flex items-center justify-center p-4 rounded-lg ${
          isLoading.clearCache 
            ? 'bg-amber-400 cursor-not-allowed' 
            : 'bg-amber-600 hover:bg-amber-700'
        } text-white font-medium transition`}
      >
        {isLoading.clearCache ? '处理中...' : '清除所有缓存'}
      </button>
      <button 
        onClick={handleResetDatabase}
        disabled={isLoading.resetDatabase}
        className={`flex items-center justify-center p-4 rounded-lg ${
          isLoading.resetDatabase 
            ? 'bg-red-400 cursor-not-allowed' 
            : 'bg-red-600 hover:bg-red-700'
        } text-white font-medium transition`}
      >
        {isLoading.resetDatabase ? '处理中...' : '重置所有数据库'}
      </button>
    </div>
  );
} 