'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface TableInfo {
  name: string;
  rowCount: number;
}

interface RowData {
  [key: string]: unknown;
}

export default function DatabaseView() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<RowData[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 获取所有表的信息
  useEffect(() => {
    const fetchTables = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/admin/database-tables');
        if (!response.ok) {
          throw new Error(`获取表信息失败: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success) {
          setTables(data.tables || []);
        } else {
          setError(data.message || '获取表信息失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取表信息时发生错误');
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  // 获取选中表的数据
  const fetchTableData = async (tableName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/table-data?table=${encodeURIComponent(tableName)}`);
      if (!response.ok) {
        throw new Error(`获取表数据失败: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setTableData(data.rows || []);
        setColumns(data.columns || []);
        setSelectedTable(tableName);
      } else {
        setError(data.message || '获取表数据失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取表数据时发生错误');
    } finally {
      setLoading(false);
    }
  };

  // 处理表选择
  const handleTableSelect = (tableName: string) => {
    fetchTableData(tableName);
  };

  // 格式化显示数据
  const formatValue = (value: unknown): string => {
    if (value === null) return 'null';
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  return (
    <div className="flex flex-col min-h-screen p-8 bg-gray-50">
      <div className="w-full max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">数据库可视化</h1>
          <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
            返回首页
          </Link>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p>{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* 表格列表 */}
          <div className="md:col-span-1 bg-white p-4 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">数据库表</h2>
            {loading && tables.length === 0 ? (
              <p className="text-gray-600">加载中...</p>
            ) : tables.length > 0 ? (
              <ul className="space-y-2">
                {tables.map((table) => (
                  <li key={table.name}>
                    <button
                      onClick={() => handleTableSelect(table.name)}
                      className={`w-full text-left px-3 py-2 rounded ${
                        selectedTable === table.name
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <span className="font-medium">{table.name}</span>
                      <span className="text-sm text-gray-500 ml-2">({table.rowCount}行)</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-600">没有找到数据库表</p>
            )}
          </div>

          {/* 表格数据 */}
          <div className="md:col-span-3 bg-white p-4 rounded-lg shadow overflow-x-auto">
            {selectedTable ? (
              <>
                <h2 className="text-xl font-semibold mb-4">
                  {selectedTable} <span className="text-sm font-normal text-gray-500">({tableData.length} 行)</span>
                </h2>
                {loading ? (
                  <p className="text-gray-600">加载中...</p>
                ) : columns.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {columns.map((column) => (
                            <th
                              key={column}
                              scope="col"
                              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {tableData.map((row, rowIndex) => (
                          <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            {columns.map((column) => (
                              <td
                                key={`${rowIndex}-${column}`}
                                className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate"
                                title={formatValue(row[column])}
                              >
                                <span className="inline-flex items-center">
                                  <span 
                                    className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                      row[column] === null 
                                        ? 'bg-gray-300' 
                                        : typeof row[column] === 'object' 
                                          ? 'bg-purple-500' 
                                          : 'bg-green-500'
                                    }`}
                                  ></span>
                                  {formatValue(row[column])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-600">表中没有数据</p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <svg
                  className="w-16 h-16 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7zM9 16V8M15 16V8"
                  />
                </svg>
                <p className="text-xl">请选择一个表来查看数据</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 