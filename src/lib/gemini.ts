import { logError, logWithTime } from '@/lib/logger';
import { extractJsonFromMarkdown, generateTextWithFallback } from '@/lib/llm/gemini-provider';

const MODULE_NAME = 'GEMINI VIDEO';

export { extractJsonFromMarkdown };

/**
 * Evaluate a public YouTube video using Gemini multimodal analysis.
 */
export async function evaluateYouTubeVideo(youtubeUrl: string, prompt: string): Promise<string> {
  logWithTime(MODULE_NAME, '开始评估YouTube视频', { youtubeUrl });

  try {
    const request = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: youtubeUrl,
                mimeType: 'video/mp4',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const responseText = await generateTextWithFallback('video-evaluation', request);
    logWithTime(MODULE_NAME, '视频评估完成');
    return responseText;
  } catch (error) {
    logError(MODULE_NAME, '视频评估请求失败', error);
    throw new Error(`视频评估请求失败: ${(error as Error).message}`);
  }
}
