import { VertexAI } from '@google-cloud/vertexai';

// 添加时间戳的日志函数
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [VERTEX AI] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [VERTEX AI] ${message}`);
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [VERTEX AI ERROR] ${message}`, error);
  console.error(`Stack: ${(error as Error).stack || 'No stack trace'}`);
}

/**
 * 从响应文本中提取JSON数据
 */
export function extractJsonFromMarkdown(text: string): Record<string, unknown> | null {
  try {
    logWithTime('尝试从响应中提取JSON');
    
    // 直接尝试解析整个文本
    try {
      const result = JSON.parse(text);
      logWithTime('成功直接解析JSON');
      return result;
    /* eslint-disable @typescript-eslint/no-unused-vars */
    } catch (_) {
    /* eslint-enable @typescript-eslint/no-unused-vars */
      logWithTime('直接解析失败，尝试其他方法');
    }

    // 尝试提取代码块中的JSON
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = text.match(codeBlockRegex);
    if (match && match[1]) {
      try {
        const result = JSON.parse(match[1]);
        logWithTime('成功从代码块中解析JSON');
        return result;
      /* eslint-disable @typescript-eslint/no-unused-vars */
      } catch (_) {
      /* eslint-enable @typescript-eslint/no-unused-vars */
        logWithTime('代码块解析失败，继续尝试其他方法');
      }
    }

    // 尝试提取文本中任何看起来像JSON的部分
    const jsonRegex = /\{[\s\S]*\}/;
    const jsonMatch = text.match(jsonRegex);
    if (jsonMatch && jsonMatch[0]) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        logWithTime('成功从文本中提取并解析JSON');
        return result;
      /* eslint-disable @typescript-eslint/no-unused-vars */
      } catch (jsonError) {
      /* eslint-enable @typescript-eslint/no-unused-vars */
        logWithTime('JSON提取失败，尝试修复常见错误');
        
        // 尝试修复一些常见的JSON格式错误
        let fixedJson = jsonMatch[0];
        
        // 1. 处理单引号替换为双引号
        fixedJson = fixedJson.replace(/(['"])([^'"]*?)(['"])\s*:/g, '"$2":');
        fixedJson = fixedJson.replace(/:\s*(['"])([^'"]*?)(['"])/g, ':"$2"');
        
        // 2. 处理末尾多余的逗号
        fixedJson = fixedJson.replace(/,\s*}/g, '}');
        fixedJson = fixedJson.replace(/,\s*\]/g, ']');
        
        // 尝试解析修复后的JSON
        try {
          const result = JSON.parse(fixedJson);
          logWithTime('成功修复并解析JSON');
          return result;
        /* eslint-disable @typescript-eslint/no-unused-vars */
        } catch (_) {
        /* eslint-enable @typescript-eslint/no-unused-vars */
          logWithTime('修复后仍然无法解析JSON');
        }
      }
    }

    logWithTime('所有JSON解析方法都失败');
    return null;
  } catch (error) {
    logError('JSON提取过程发生错误', error);
    return null;
  }
}

/**
 * 使用Vertex AI评估YouTube视频
 * 
 * @param youtubeUrl YouTube视频URL，必须是公开可访问的
 * @param prompt 提示文本，指导AI如何分析视频
 * @returns 返回AI生成的文本响应
 */
export async function evaluateYouTubeVideo(youtubeUrl: string, prompt: string): Promise<string> {
  logWithTime('开始评估YouTube视频');
  logWithTime(`视频URL: ${youtubeUrl}`);
  
  try {
    // 项目配置
    const projectId = 'open-impact-lab-zob4aq';
    const location = 'us-central1';
    const modelName = 'gemini-2.5-pro';
    
    // 初始化Vertex AI（需要确保环境已配置好Google Cloud认证）
    const vertexAI = new VertexAI({
      project: projectId, 
      location: location
    });
    
    // 获取生成式模型
    const generativeModel = vertexAI.getGenerativeModel({
      model: modelName,
    });
    
    logWithTime('发送视频评估请求到Vertex AI');
    logWithTime(prompt);
    
    // 构建符合Vertex AI类型定义的请求
    const filePart = {
      fileData: {
        fileUri: youtubeUrl,
        mimeType: "video/mp4", // 为YouTube视频指定MIME类型
      },
    };
    
    const textPart = {
      text: prompt,
    };
    
    const request = {
      contents: [
        {
          role: 'user',
          parts: [filePart, textPart],
        },
      ],
    };
    
    // 发送请求并等待响应
    const response = await generativeModel.generateContent(request);
    const aggregatedResponse = await response.response;
    
    logWithTime('视频评估请求成功');
    
    // 检查响应是否包含有效内容
    if (!aggregatedResponse.candidates || 
        aggregatedResponse.candidates.length === 0 || 
        !aggregatedResponse.candidates[0].content ||
        !aggregatedResponse.candidates[0].content.parts ||
        aggregatedResponse.candidates[0].content.parts.length === 0) {
      throw new Error('收到的响应不包含有效内容');
    }
    
    // 获取响应文本并处理可能的undefined
    const firstPart = aggregatedResponse.candidates[0].content.parts[0];
    const responseText = firstPart.text || '';
    
    return responseText;
  } catch (error) {
    logError('视频评估请求失败', error);
    throw new Error(`视频评估请求失败: ${(error as Error).message}`);
  }
} 