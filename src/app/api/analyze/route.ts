import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 4000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      const isRetryable = message.includes('429') || message.includes('503') || message.includes('500');
      if (isRetryable && i < retries - 1) {
        // 4s → 8s → 16s
        await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}

// 지문 1개만 처리 — 클라이언트가 병렬/진행상황을 orchestrate함
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    return NextResponse.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { passage, textbook, number } = await req.json() as {
    passage: string;
    textbook?: string;
    number?: string;
  };

  if (!passage?.trim()) {
    return NextResponse.json({ error: '지문이 비어있습니다.' }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  try {
    const userPrompt = buildUserPrompt(passage, textbook, number);
    const result = await withRetry(() =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
      })
    );
    const response = result.response;
    return NextResponse.json({
      markdown: response.text(),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
