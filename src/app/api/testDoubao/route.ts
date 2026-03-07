import { NextResponse } from 'next/server';

import { generateTextWithFallback } from '@/lib/llm/gemini-provider';

export async function GET() {
  try {
    const text = await generateTextWithFallback(
      'health-check',
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with the single word OK.' }],
          },
        ],
      },
    );

    return NextResponse.json({
      success: true,
      provider: 'gemini',
      message: text.trim(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: 'gemini',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
