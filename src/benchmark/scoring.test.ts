import { describe, expect, it } from 'vitest';
import type { ValidationReport } from '../engine/types.ts';
import { scoreAgent, scoreAll } from './scoring.ts';
import type { AnswerKey } from './types.ts';

const makeMutation = (over: Partial<AnswerKey['cases'][number]['mutations'][number]>) => ({
  id: 'm1',
  type: 'font-size' as const,
  key: '10',
  ancestors: ['1', '5'],
  descendants: ['11'],
  props: ['fontSize', 'lineHeight'],
  insideSpec: true,
  description: 'font-size +3px',
  ...over,
});

const answerKey: AnswerKey = {
  generatedAt: '2026-11-20',
  seed: 1,
  cases: [
    { id: 'case-01', control: true, mutations: [] },
    { id: 'case-02', control: false, mutations: [makeMutation({})] },
    {
      id: 'case-03',
      control: false,
      mutations: [
        makeMutation({
          id: 'm2',
          type: 'text',
          key: '11',
          ancestors: ['10', '5'],
          descendants: [],
          props: ['text'],
          insideSpec: false,
        }),
      ],
    },
  ],
};

const makeReport = (fails: [string, string][], extra: [string, string][] = []): ValidationReport => ({
  generatedAt: '2026-11-20',
  url: 'http://localhost:5199',
  viewport: { width: 1440, height: 900 },
  page: { width: 1440, height: 900 },
  figmaFrame: null,
  rootFound: true,
  summary: { regions: 2, checks: 0, pass: 0, fail: fails.length + extra.length, warn: 0, score: null },
  pendingStates: [],
  regions: [
    {
      name: 'Title',
      selector: '#title',
      key: '10',
      results: [...fails.filter(([k]) => k === '10'), ...extra.filter(([k]) => k === '10')].map(([, p]) => ({
        property: p,
        expected: 'a',
        actual: 'b',
        status: 'fail',
      })),
    },
    {
      name: 'Card',
      selector: '.card',
      key: '5',
      results: [...fails.filter(([k]) => k === '5'), ...extra.filter(([k]) => k === '5')].map(([, p]) => ({
        property: p,
        expected: 'a',
        actual: 'b',
        status: 'fail',
      })),
    },
  ],
});

describe('scoreAgent', () => {
  it('detects mutations by element key and property', () => {
    const score = scoreAgent('engine', answerKey, {
      'case-01': makeReport([]),
      'case-02': makeReport([['10', 'fontSize']]),
    });
    expect(score.detection).toEqual({ total: 1, hits: 1, rate: 1 });
    expect(score.falsePositives).toBe(0);
  });

  it('credits text mutation in child when ancestor text fails', () => {
    const score = scoreAgent('engine', answerKey, {
      'case-03': makeReport([['10', 'text']]),
    });
    expect(score.outsideSpec.hits).toBe(1);
  });

  it('ignores baseline failures present in control case', () => {
    const base: [string, string][] = [['5', 'minHeight']];
    const score = scoreAgent('engine', answerKey, {
      'case-01': makeReport(base),
      'case-02': makeReport([['10', 'fontSize']], base),
    });
    expect(score.falsePositives).toBe(0);
    expect(score.controls).toEqual({ executed: 0, clean: 0 });
  });

  it('requires value change from baseline to credit detection', () => {
    const withVal = (key: string, prop: string, actual: string): ValidationReport => ({
      ...makeReport([]),
      regions: [{ name: 'x', selector: '.x', key, results: [{ property: prop, expected: 'Inter', actual, status: 'fail' }] }],
    });
    const key: AnswerKey = {
      ...answerKey,
      cases: [
        {
          id: 'c',
          control: false,
          mutations: [makeMutation({ type: 'font-family', key: '5', descendants: ['10'], props: ['fontFamily'] })],
        },
      ],
    };
    const same = scoreAgent('engine', key, {
      base: withVal('10', 'fontFamily', 'Space Grotesk'),
      c: withVal('10', 'fontFamily', 'Space Grotesk'),
    });
    expect(same.detection.hits).toBe(0);

    const changed = scoreAgent('engine', key, {
      base: withVal('10', 'fontFamily', 'Space Grotesk'),
      c: withVal('10', 'fontFamily', 'Courier New'),
    });
    expect(changed.detection.hits).toBe(1);
  });

  it('counts new failures in control cases as false positives when base snapshot exists', () => {
    const score = scoreAgent('engine', answerKey, {
      base: makeReport([]),
      'case-01': makeReport([['5', 'rowGap']]),
    });
    expect(score.controls).toEqual({ executed: 1, clean: 0 });
    expect(score.falsePositives).toBe(1);
  });

  it('counts unexplained failures and ignores layout side effects', () => {
    const fpScore = scoreAgent('engine', answerKey, {
      'case-01': makeReport([]),
      'case-02': makeReport([
        ['10', 'fontSize'],
        ['5', 'backgroundColor'],
      ]),
    });
    expect(fpScore.falsePositives).toBe(1);
    expect(fpScore.cases.find((c) => c.id === 'case-02')!.falsePositives[0].property).toBe('backgroundColor');

    const sideEffectScore = scoreAgent('engine', answerKey, {
      'case-01': makeReport([]),
      'case-02': makeReport([
        ['10', 'fontSize'],
        ['5', 'height'],
      ]),
    });
    expect(sideEffectScore.falsePositives).toBe(0);
  });
});

describe('scoreAll', () => {
  it('computes inter-agent agreement excluding local engine', () => {
    const scoreboard = scoreAll(answerKey, {
      engine: { 'case-02': makeReport([['10', 'fontSize']]) },
      claude: { 'case-02': makeReport([['10', 'fontSize']]), 'case-03': makeReport([]) },
      codex: { 'case-02': makeReport([]), 'case-03': makeReport([]) },
    });
    expect(scoreboard.agents.map((a) => a.agent)).toEqual(['engine', 'claude', 'codex']);
    expect(scoreboard.agreement).toEqual({ total: 2, hits: 1, rate: 0.5 });
  });
});
