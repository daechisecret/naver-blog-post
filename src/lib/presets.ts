export type PresetStyle =
  | 'none'
  | 'mock'
  | 'style1'
  | 'style2'
  | 'style3'
  | 'style4'
  | 'style5'
  | 'mockTest';

export interface PresetInfo {
  label: string;
  fixedCount: number | null;
  generator: (count: number) => string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);

const MOCK_LABELS = [
  '18번', '19번', '20번', '21번', '22번', '23번', '24번',
  '26번', '29번', '30번', '31번', '32번', '33번', '34번',
  '35번', '36번', '37번', '38번', '39번', '40번', '41-42번',
];

const MOCK_TEST_LABELS = [
  '1번', '2번', '3번', '4번', '5번', '6번', '7번',
  '9번', '12번', '13번', '14번', '15번', '16번', '17번',
  '18번', '19번', '20번', '21번', '22번', '23번', '24-25번',
];

export const PRESETS: Record<PresetStyle, PresetInfo> = {
  none: {
    label: '없음 (지문 1, 2 ...)',
    fixedCount: null,
    generator: (n) => range(1, n).map((i) => `지문 ${i}`),
  },
  mock: {
    label: '🎯 모의고사형 (21개 고정)',
    fixedCount: 21,
    generator: () => MOCK_LABELS,
  },
  style1: {
    label: '📖 본문형 (본문 1, 2 ...)',
    fixedCount: null,
    generator: (n) => range(1, n).map((i) => `본문 ${i}`),
  },
  style2: {
    label: '🌟 Gateway형 (Gateway, Exercise 01 ...)',
    fixedCount: null,
    generator: (n) => ['Gateway', ...range(1, Math.max(n - 1, 0)).map((i) => `Exercise ${pad2(i)}`)],
  },
  style3: {
    label: '🔢 번호형 (1번, 2번 ...)',
    fixedCount: null,
    generator: (n) => range(1, n).map((i) => `${i}번`),
  },
  style4: {
    label: '📊 Analysis형 (Analysis, Exercise 01 ...)',
    fixedCount: null,
    generator: (n) => ['Analysis', ...range(1, Math.max(n - 1, 0)).map((i) => `Exercise ${pad2(i)}`)],
  },
  style5: {
    label: '📝 Exercise형 (Exercise 1, 2 ...)',
    fixedCount: null,
    generator: (n) => range(1, n).map((i) => `Exercise ${i}`),
  },
  mockTest: {
    label: '📋 모의고사 TEST (21개 고정)',
    fixedCount: 21,
    generator: () => MOCK_TEST_LABELS,
  },
};

export function getLabels(style: PresetStyle, count: number): string[] {
  const preset = PRESETS[style];
  const actualCount = preset.fixedCount ?? count;
  return preset.generator(actualCount);
}

export function isFixedStyle(style: PresetStyle): boolean {
  return PRESETS[style].fixedCount !== null;
}

export const COUNT_PRESETS = [3, 4, 5, 8, 12, 21] as const;
