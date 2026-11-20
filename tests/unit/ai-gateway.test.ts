import { describe, expect, it } from 'vitest';
import { AiGateway, AiPolicyError, parseNarration } from '../../src/api/ai/gateway';
import {
  DemoAiProvider,
  createAiProvider,
  loadAiConfig,
  type AiCallOptions,
  type AiCompletion,
  type AiConfig,
  type AiMessage,
  type AiProvider,
} from '../../src/api/ai/provider';

const demoConfig: AiConfig = {
  kind: 'demo',
  model: 'demo-deterministic',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  maxTokensPerCall: 100,
  dailyBudgetTokens: 1000,
  maxCallsPerMinute: 2,
  timeoutMs: 1000,
};

const input = {
  siteName: '○○川 築堤・護岸工事',
  task: '盛土 出来形管理',
  verdict: '合格',
  metrics: [
    { label: '合格率', value: '100.0%' },
    { label: '平均偏差', value: '+0.012m' },
  ],
};

describe('AI provider', () => {
  it('demo provider returns schema-valid JSON without network access', async () => {
    const provider = new DemoAiProvider();
    const out = await provider.complete(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: '合格率 100.0%\n平均偏差 +0.012m' },
      ],
      { maxTokens: 100, timeoutMs: 1000 },
    );
    expect(provider.live).toBe(false);
    const narration = parseNarration(out.text);
    expect(narration.headline.length).toBeGreaterThanOrEqual(4);
    expect(narration.notes.length).toBeGreaterThanOrEqual(1);
  });

  it('loadAiConfig falls back to demo when no key is configured', () => {
    const cfg = loadAiConfig({} as NodeJS.ProcessEnv);
    expect(cfg.kind).toBe('demo');
    expect(createAiProvider(cfg).live).toBe(false);
  });

  it('loadAiConfig selects the live provider when a key is present', () => {
    const cfg = loadAiConfig({
      SAS_AI_PROVIDER: 'openai',
      SAS_AI_API_KEY: 'sk-test',
      SAS_AI_MODEL: 'gpt-test',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.kind).toBe('openai');
    const provider = createAiProvider(cfg);
    expect(provider.live).toBe(true);
    expect(provider.model).toBe('gpt-test');
  });
});

describe('AiGateway policy', () => {
  it('narrates facts and reports usage', async () => {
    const gateway = new AiGateway(new DemoAiProvider(), demoConfig);
    const result = await gateway.narrate(input);
    expect(result.narration.headline.length).toBeGreaterThan(0);
    expect(result.meta.live).toBe(false);
    expect(result.meta.tokensToday).toBeGreaterThan(0);
    expect(gateway.usage().callsToday).toBe(1);
  });

  it('rejects calls over the per-minute rate limit', async () => {
    const gateway = new AiGateway(new DemoAiProvider(), demoConfig);
    await gateway.narrate(input);
    await gateway.narrate(input);
    await expect(gateway.narrate(input)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
  });

  it('rejects calls when the daily token budget is exhausted', async () => {
    const tight: AiConfig = { ...demoConfig, dailyBudgetTokens: 50, maxTokensPerCall: 100 };
    const gateway = new AiGateway(new DemoAiProvider(), tight);
    await expect(gateway.narrate(input)).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });

  it('rejects an output that is not valid JSON or breaks the contract', async () => {
    const bad: AiProvider = {
      name: 'bad',
      model: 'bad',
      live: false,
      async complete(_messages: AiMessage[], _options: AiCallOptions): Promise<AiCompletion> {
        return {
          text: 'not-json',
          provider: 'bad',
          model: 'bad',
          live: false,
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    };
    const gateway = new AiGateway(bad, demoConfig);
    await expect(gateway.narrate(input)).rejects.toBeInstanceOf(AiPolicyError);
    await expect(gateway.narrate(input)).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
  });

  it('never computes numbers: the narration only echoes the given facts', async () => {
    const gateway = new AiGateway(new DemoAiProvider(), demoConfig);
    const result = await gateway.narrate(input);
    expect(result.narration.headline).toContain('合格');
    // 数値は入力（計算エンジンの結果）の引用のみ。AIは再計算しない。
    expect(result.narration.notes.join(' ')).toContain('100.0%');
    expect(result.narration.notes.join(' ')).toContain('+0.012m');
    expect(input.metrics.map((m) => m.value)).toContain('+0.012m');
  });
});
