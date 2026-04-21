'use client';

import { useState, useEffect, useCallback } from 'react';
import { markdownToHtml } from '@/lib/markdown-to-html';
import { PresetStyle, PRESETS, COUNT_PRESETS, getLabels, isFixedStyle } from '@/lib/presets';

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

interface LogEntry {
  id: string;
  ts: string;
  msg: string;
  type: 'info' | 'progress' | 'success' | 'error' | 'complete';
  startTime?: number; // progress 타입일 때 경과 시간 계산용
  label?: string;     // 진행 중일 때 동적으로 재구성
  index?: number;     // 지문 번호 (1-based)
  total?: number;     // 전체 개수
}

// 경과 시간 기반 추정 % (5~7초 평균 기준, 95% 상한)
function estimatePercent(elapsedMs: number): number {
  return Math.min(95, Math.round((elapsedMs / 6000) * 100));
}

interface MonthlyUsage {
  month: string;
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
  const [presetStyle, setPresetStyle] = useState<PresetStyle>('none');
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [usage, setUsage] = useState<MonthlyUsage>({ month: '', inputTokens: 0, outputTokens: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [, setTick] = useState(0); // 진행 중 지문의 경과 시간 실시간 갱신용

  useEffect(() => {
    setUsage(getUsage());
  }, []);

  // loading 중에는 200ms 주기로 리렌더 (진행 중 지문의 경과 시간/%% 갱신)
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [loading]);

  const nowTs = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });

  const pushLog = (entry: Omit<LogEntry, 'ts'>) => {
    setLogs((prev) => [...prev, { ...entry, ts: nowTs() }]);
  };

  const updateLog = (id: string, patch: Partial<LogEntry>) => {
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  // 지문 수 변경 시: 부족하면 추가, 넘치면 잘라냄. 스타일 라벨 자동 주입.
  const resizePassages = (targetCount: number, style: PresetStyle = presetStyle) => {
    const labels = getLabels(style, targetCount);
    setPassages((prev) => {
      const next: PassageInput[] = [];
      for (let i = 0; i < targetCount; i++) {
        const existing = prev[i];
        next.push({
          id: existing?.id ?? i + 1,
          textbook: existing?.textbook ?? '',
          number: style === 'none' ? (existing?.number ?? '') : labels[i] ?? '',
          text: existing?.text ?? '',
        });
      }
      return next;
    });
  };

  const applyPresetStyle = (style: PresetStyle) => {
    setPresetStyle(style);
    const preset = PRESETS[style];
    const targetCount = preset.fixedCount ?? passages.length;
    resizePassages(targetCount, style);
  };

  const applyCountPreset = (count: number) => {
    // 고정 스타일이면 개수 변경 불가 → none으로 먼저 되돌림
    if (isFixedStyle(presetStyle)) {
      setPresetStyle('none');
      resizePassages(count, 'none');
    } else {
      resizePassages(count, presetStyle);
    }
  };

  const addPassage = () => {
    if (isFixedStyle(presetStyle)) return;
    setPassages((prev) => {
      const newIdx = prev.length;
      const labels = getLabels(presetStyle, newIdx + 1);
      return [
        ...prev,
        {
          id: newIdx + 1,
          textbook: '',
          number: presetStyle === 'none' ? '' : labels[newIdx] ?? '',
          text: '',
        },
      ];
    });
  };

  const removePassage = (id: number) => {
    if (isFixedStyle(presetStyle)) return;
    if (passages.length <= 1) return;
    setPassages((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePassage = (id: number, field: keyof PassageInput, value: string) => {
    setPassages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const analyze = async () => {
    const valid = passages.filter((p) => p.text.trim());
    if (valid.length === 0) {
      alert('지문을 하나 이상 입력해주세요.');
      return;
    }

    setLoading(true);
    setResults([]);
    setLogs([]);
    setProgress({ done: 0, total: valid.length });
    pushLog({
      id: 'start',
      msg: `🚀 분석 시작 — 지문 ${valid.length}개 (병렬 3개 처리, gemini-2.5-flash)`,
      type: 'info',
    });

    const resultsArr: AnalysisResult[] = new Array(valid.length);
    let totalInput = 0;
    let totalOutput = 0;

    const processOne = async (p: PassageInput, i: number) => {
      const label = (p.textbook || p.number) ? `${p.textbook || ''} ${p.number || ''}`.trim() : `지문 ${i + 1}`;
      const logId = `task-${i}`;
      const startTime = Date.now();

      // 진행 중 로그 엔트리 등록 (경과시간/%는 렌더 시점에 동적 계산)
      pushLog({
        id: logId,
        msg: '',
        type: 'progress',
        startTime,
        label,
        index: i + 1,
        total: valid.length,
      });

      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            passage: p.text,
            textbook: p.textbook,
            number: p.number,
          }),
        });
        const data = await res.json();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (data.error) {
          updateLog(logId, {
            type: 'error',
            msg: `❌ [${i + 1}/${valid.length}] ${label} 실패 (${elapsed}s): ${String(data.error).slice(0, 100)}`,
          });
          resultsArr[i] = { index: i, markdown: '', html: '', error: data.error };
        } else {
          const tokens = (data.inputTokens || 0) + (data.outputTokens || 0);
          updateLog(logId, {
            type: 'success',
            msg: `✅ [${i + 1}/${valid.length}] ${label} 완료 (${elapsed}s, ${tokens.toLocaleString()} 토큰)`,
          });
          resultsArr[i] = {
            index: i,
            markdown: data.markdown,
            html: markdownToHtml(data.markdown),
          };
          totalInput += data.inputTokens || 0;
          totalOutput += data.outputTokens || 0;
        }
      } catch (e) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const msg = e instanceof Error ? e.message : 'Unknown';
        updateLog(logId, {
          type: 'error',
          msg: `❌ [${i + 1}/${valid.length}] ${label} 네트워크 오류 (${elapsed}s): ${msg}`,
        });
        resultsArr[i] = { index: i, markdown: '', html: '', error: msg };
      }

      setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      setResults(resultsArr.filter(Boolean));
    };

    // 병렬 3개 제한 (worker pool)
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= valid.length) return;
        await processOne(valid[idx], idx);
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    pushLog({
      id: 'complete',
      msg: `🎉 전체 완료 — 총 ${(totalInput + totalOutput).toLocaleString()} 토큰 사용`,
      type: 'complete',
    });
    if (totalInput + totalOutput > 0) {
      const updated = addUsage(totalInput, totalOutput);
      setUsage(updated);
    }
    setLoading(false);
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
  const fixed = isFixedStyle(presetStyle);

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

      {/* 지문 개수 프리셋 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>
          지문 개수 프리셋
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COUNT_PRESETS.map((n) => (
            <button
              key={n}
              onClick={() => applyCountPreset(n)}
              disabled={loading}
              style={{
                padding: '6px 14px',
                border: '1.5px solid',
                borderColor: passages.length === n && !fixed ? '#2563eb' : '#ccc',
                background: passages.length === n && !fixed ? '#dbeafe' : 'white',
                color: passages.length === n && !fixed ? '#1d4ed8' : '#333',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              {n}개
            </button>
          ))}
          <span style={{ alignSelf: 'center', color: '#888', fontSize: 12, marginLeft: 8 }}>
            현재: <b>{passages.length}</b>개
          </span>
        </div>
      </div>

      {/* 지문 스타일 프리셋 */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6 }}>
          지문 라벨 스타일
        </label>
        <select
          value={presetStyle}
          onChange={(e) => applyPresetStyle(e.target.value as PresetStyle)}
          disabled={loading}
          style={{
            padding: '8px 12px',
            border: '1.5px solid #ccc',
            borderRadius: 6,
            fontSize: 13,
            background: 'white',
            cursor: loading ? 'default' : 'pointer',
            minWidth: 280,
          }}
        >
          {Object.entries(PRESETS).map(([key, info]) => (
            <option key={key} value={key}>{info.label}</option>
          ))}
        </select>
        {fixed && (
          <span style={{ marginLeft: 10, color: '#d97706', fontSize: 12 }}>
            ⚠ 고정 21지문 — 개수/추가/삭제 잠금
          </span>
        )}
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
            <span style={{ fontWeight: 'bold' }}>
              {p.number ? p.number : `지문 ${idx + 1}`}
            </span>
            {!fixed && passages.length > 1 && (
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
        {!fixed && (
          <button
            onClick={addPassage}
            disabled={loading}
            style={{ padding: '8px 16px', border: '1px solid #333', borderRadius: 4, cursor: loading ? 'default' : 'pointer' }}
          >
            + 지문 추가
          </button>
        )}
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
          {loading ? `분석 중... (${progress.done}/${progress.total})` : '분석하기'}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{
          marginBottom: 20,
          padding: 12,
          background: '#1e1e1e',
          color: '#e0e0e0',
          borderRadius: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.6,
          maxHeight: 260,
          overflowY: 'auto',
          border: '1px solid #333',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: '1px solid #444',
            position: 'sticky',
            top: 0,
            background: '#1e1e1e',
          }}>
            <span style={{ color: '#4ade80', fontWeight: 'bold' }}>
              📋 진행 로그 {loading && `(${progress.done}/${progress.total})`}
            </span>
            {!loading && (
              <button
                onClick={() => setLogs([])}
                style={{
                  background: 'transparent',
                  color: '#888',
                  border: '1px solid #555',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                지우기
              </button>
            )}
          </div>
          {logs.map((log) => {
            // progress 타입은 렌더 시점에 경과시간/% 동적 계산
            let displayMsg = log.msg;
            if (log.type === 'progress' && log.startTime) {
              const elapsedMs = Date.now() - log.startTime;
              const elapsedSec = (elapsedMs / 1000).toFixed(1);
              const pct = estimatePercent(elapsedMs);
              displayMsg = `⏳ [${log.index}/${log.total}] ${log.label} 분석 중... ${pct}% (${elapsedSec}s)`;
            }
            const color =
              log.type === 'error' ? '#f87171' :
              log.type === 'success' ? '#4ade80' :
              log.type === 'complete' ? '#fbbf24' :
              log.type === 'info' ? '#60a5fa' :
              log.type === 'progress' ? '#fcd34d' :
              '#e0e0e0';
            return (
              <div key={log.id} style={{
                color,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                <span style={{ color: '#666', marginRight: 6 }}>[{log.ts}]</span>
                {displayMsg}
              </div>
            );
          })}
        </div>
      )}

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
                    {passages[r.index]?.number || `지문 ${r.index + 1}`}
                    {passages[r.index]?.textbook && ` - ${passages[r.index].textbook}`}
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
