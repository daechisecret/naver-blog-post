import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 5000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('429') && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    return NextResponse.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { passages } = await req.json() as {
    passages: { text: string; textbook?: string; number?: string }[];
  };

  if (!passages || passages.length === 0) {
    return NextResponse.json({ error: '지문을 입력해주세요.' }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const results: { index: number; markdown: string; error?: string }[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    if (!p.text.trim()) continue;

    try {
      const userPrompt = buildUserPrompt(p.text, p.textbook, p.number);
      const result = await withRetry(() =>
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
        })
      );
      const response = result.response;
      const text = response.text();

      const usage = response.usageMetadata;
      if (usage) {
        totalInputTokens += usage.promptTokenCount ?? 0;
        totalOutputTokens += usage.candidatesTokenCount ?? 0;
      }

      results.push({ index: i, markdown: text });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      results.push({ index: i, markdown: '', error: message });
    }
  }

  return NextResponse.json({
    results,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  });
}
