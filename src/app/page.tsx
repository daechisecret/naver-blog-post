'use client';

import { useState, useEffect, useCallback } from 'react';
import { markdownToHtml } from '@/lib/markdown-to-html';

interface PassageInput {
  id: number;
  textbook: string;
  number: string;
  text: string;
}

interface AnalysisResult {
  index: number;
  markdown: string;
  html: string;
  error?: string;
}

interface MonthlyUsage {
  month: string; // YYYY-MM
  inputTokens: number;
  outputTokens: number;
}

// Gemini 2.0 Flash pricing (USD per 1M tokens)
const INPUT_PRICE_PER_M = 0.10;
const OUTPUT_PRICE_PER_M = 0.40;
const USD_TO_KRW = 1450;

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getUsage(): MonthlyUsage {
  const key = `usage-${getMonthKey()}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { month: getMonthKey(), inputTokens: 0, outputTokens: 0 };
}

function addUsage(inputTokens: number, outputTokens: number) {
  const usage = getUsage();
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  localStorage.setItem(`usage-${getMonthKey()}`, JSON.stringify(usage));
  return usage;
}

function calcCostKRW(usage: MonthlyUsage) {
  const inputCostUSD = (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_M;
  const outputCostUSD = (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M;
  return Math.round((inputCostUSD + outputCostUSD) * USD_TO_KRW);
}

export default function Home() {
  const [passages, setPassages] = useState<PassageInput[]>([
    { id: 1, textbook: '', number: '', text: '' },
  ]);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [usage, setUsage] = useState<MonthlyUsage>({ month: '', inputTokens: 0, outputTokens: 0 });

  useEffect(() => {
    setUsage(getUsage());
  }, []);

  const addPassage = () => {
    setPassages((prev) => [
      ...prev,
      { id: prev.length + 1, textbook: '', number: '', text: '' },
    ]);
  };

  const removePassage = (id: number) => {
    if (passages.length <= 1) return;
    setPassages((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePassage = (id: number, field: keyof PassageInput, value: string) => {
    setPassages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const analyze = async () => {
    setLoading(true);
    setResults([]);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passages: passages.map((p) => ({
            text: p.text,
            textbook: p.textbook,
            number: p.number,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      const mapped = data.results.map((r: { index: number; markdown: string; error?: string }) => ({
        ...r,
        html: markdownToHtml(r.markdown),
      }));
      setResults(mapped);

      // Track usage
      if (data.usage) {
        const updated = addUsage(data.usage.inputTokens, data.usage.outputTokens);
        setUsage(updated);
      }
    } catch (e) {
      alert('분석 중 오류가 발생했습니다: ' + (e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = useCallback(async (index: number) => {
    const el = document.getElementById(`result-${index}`);
    if (!el) return;

    const html = el.innerHTML;
    const text = el.innerText;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      setCopied(index);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      selection?.removeAllRanges();
      setCopied(index);
      setTimeout(() => setCopied(null), 2000);
    }
  }, []);

  const copyAll = async () => {
    const container = document.getElementById('all-results');
    if (!container) return;

    const html = container.innerHTML;
    const text = container.innerText;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      setCopied(-1);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      selection?.removeAllRanges();
      setCopied(-1);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const costKRW = calcCostKRW(usage);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>
        네이버 블로그 영어 지문 분석기
      </h1>

      {/* Token Usage Dashboard */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginBottom: 20,
        padding: '12px 16px',
        background: '#f0f4ff',
        borderRadius: 8,
        fontSize: 14,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 'bold' }}>{usage.month || '---'} 사용량</span>
        <span>입력: <b>{usage.inputTokens.toLocaleString()}</b> 토큰</span>
        <span>출력: <b>{usage.outputTokens.toLocaleString()}</b> 토큰</span>
        <span>합계: <b>{totalTokens.toLocaleString()}</b> 토큰</span>
        <span style={{ color: '#2563eb', fontWeight: 'bold' }}>비용: ₩{costKRW.toLocaleString()}</span>
      </div>

      {passages.map((p, idx) => (
        <div
          key={p.id}
          style={{
            border: '1px solid #ccc',
            padding: 16,
            marginBottom: 12,
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 'bold' }}>지문 {idx + 1}</span>
            {passages.length > 1 && (
              <button onClick={() => removePassage(p.id)} style={{ marginLeft: 'auto', color: 'red', cursor: 'pointer' }}>
                삭제
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              placeholder="교재명 (예: 수능완성)"
              value={p.textbook}
              onChange={(e) => updatePassage(p.id, 'textbook', e.target.value)}
              style={{ flex: 1, padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
            />
            <input
              placeholder="지문번호 (예: 21번)"
              value={p.number}
              onChange={(e) => updatePassage(p.id, 'number', e.target.value)}
              style={{ width: 150, padding: 8, border: '1px solid #ddd', borderRadius: 4 }}
            />
          </div>
          <textarea
            placeholder="영어 지문을 입력하세요..."
            value={p.text}
            onChange={(e) => updatePassage(p.id, 'text', e.target.value)}
            rows={6}
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical' }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button
          onClick={addPassage}
          style={{ padding: '8px 16px', border: '1px solid #333', borderRadius: 4, cursor: 'pointer' }}
        >
          + 지문 추가
        </button>
        <button
          onClick={analyze}
          disabled={loading}
          style={{
            padding: '8px 24px',
            background: loading ? '#999' : '#333',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? '분석 중...' : '분석하기'}
        </button>
      </div>

      {results.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 'bold' }}>분석 결과</h2>
            {results.length > 1 && (
              <button
                onClick={copyAll}
                style={{
                  padding: '6px 16px',
                  background: copied === -1 ? '#22c55e' : '#333',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {copied === -1 ? '전체 복사됨!' : '전체 복사'}
              </button>
            )}
          </div>

          <div id="all-results">
            {results.map((r) => (
              <div key={r.index} style={{ marginBottom: 12, border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: '#f9f9f9' }}>
                  <span style={{ fontWeight: 'bold', flex: 1 }}>
                    지문 {r.index + 1}
                    {passages[r.index]?.textbook && ` - ${passages[r.index].textbook}`}
                    {passages[r.index]?.number && ` ${passages[r.index].number}`}
                  </span>
                  <button
                    onClick={() => copyToClipboard(r.index)}
                    style={{
                      padding: '4px 12px',
                      background: copied === r.index ? '#22c55e' : '#666',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                      marginRight: 8,
                      flexShrink: 0,
                    }}
                  >
                    {copied === r.index ? '복사됨!' : '복사'}
                  </button>
                  <button
                    onClick={() => {
                      const el = document.getElementById(`detail-${r.index}`);
                      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                    }}
                    style={{
                      padding: '4px 12px',
                      background: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    펼치기/접기
                  </button>
                </div>
                {r.error ? (
                  <div style={{ color: 'red', padding: '12px 16px' }}>오류: {r.error}</div>
                ) : (
                  <div
                    id={`detail-${r.index}`}
                    style={{ display: 'none', padding: '16px', lineHeight: 1.8 }}
                    dangerouslySetInnerHTML={{ __html: r.html }}
                  />
                )}
                {/* Hidden div for clipboard copy even when collapsed */}
                <div
                  id={`result-${r.index}`}
                  style={{ position: 'absolute', left: '-9999px' }}
                  dangerouslySetInnerHTML={{ __html: r.html }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
