import { GoogleGenerativeAI } from "@google/generative-ai";

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [GEMINI API] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [GEMINI API] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [GEMINI API ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

/**
 * 从响应文本中提取JSON数据
 */
export function extractJsonFromMarkdown(text: string): Record<string, unknown> | null {
  try {
    // 直接尝试解析整个文本
    try {
      return JSON.parse(text);
    /* eslint-disable @typescript-eslint/no-unused-vars */
    } catch (_) {
    /* eslint-enable @typescript-eslint/no-unused-vars */
      // 不是纯JSON，继续尝试提取
    }

    // 尝试提取代码块中的JSON
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = text.match(codeBlockRegex);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      /* eslint-disable @typescript-eslint/no-unused-vars */
      } catch (_) {
      /* eslint-enable @typescript-eslint/no-unused-vars */
        // 代码块解析失败，继续尝试其他方法
      }
    }

    // 尝试提取文本中任何看起来像JSON的部分
    const jsonRegex = /\{[\s\S]*\}/;
    const jsonMatch = text.match(jsonRegex);
    if (jsonMatch && jsonMatch[0]) {
      try {
        return JSON.parse(jsonMatch[0]);
      /* eslint-disable @typescript-eslint/no-unused-vars */
      } catch (_) {
      /* eslint-enable @typescript-eslint/no-unused-vars */
        // JSON解析失败，返回null
      }
    }

    return null;
  } catch (error) {
    logError('JSON提取失败', error);
    return null;
  }
}

/**
 * 使用Gemini API评估YouTube视频
 */
export async function evaluateYouTubeVideo(youtubeUrl: string, prompt: string): Promise<string> {
  logWithTime('开始评估YouTube视频');
  logWithTime(`视频URL: ${youtubeUrl}`);
  
  try {
    // 验证API密钥
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('未配置Gemini API密钥');
    }
    
    // 创建Gemini客户端
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    logWithTime('发送视频评估请求到Gemini API');
    
    // 发送评估请求
    const result = await model.generateContent([
      prompt,
      {
        fileData: {
            fileUri: youtubeUrl,
            mimeType: "video/mp4"
        },
      },
    ]);
    
    logWithTime('视频评估请求成功');
    
    // 获取响应文本
    const responseText = result.response.text();
    return responseText;
  } catch (error) {
    logError('视频评估请求失败', error);
    throw new Error(`视频评估请求失败: ${(error as Error).message}`);
  }
} 