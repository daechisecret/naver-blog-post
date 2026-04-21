import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delay = 5000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      const isRetryable = message.includes('429') || message.includes('503') || message.includes('500');
      if (isRetryable && i < retries - 1) {
        // 지수 백오프: 5s → 10s → 20s → 40s
        await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}

// Dynamic Shared Quota 스파이크 회피: 최대 N개만 동시 실행
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
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

  // 동시 실행 3개 제한 — Dynamic Shared Quota 스파이크 방지로 429 감소
  const processed = await processWithConcurrency(passages, 3, async (p, i) => {
    if (!p.text.trim()) return null;
    try {
      const userPrompt = buildUserPrompt(p.text, p.textbook, p.number);
      const result = await withRetry(() =>
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
        })
      );
      const response = result.response;
      return {
        index: i,
        markdown: response.text(),
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } catch (e: unknown) {
      return {
        index: i,
        markdown: '',
        error: e instanceof Error ? e.message : 'Unknown error',
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  });

  const filtered = processed.filter((r): r is NonNullable<typeof r> => r !== null);
  const totalInputTokens = filtered.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = filtered.reduce((s, r) => s + r.outputTokens, 0);
  const results = filtered.map(({ inputTokens: _i, outputTokens: _o, ...rest }) => rest);

  return NextResponse.json({
    results,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  });
}
