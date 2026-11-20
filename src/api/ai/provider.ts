/**
 * AIプロバイダ抽象化（実LLMへ差し替え可能な最小インターフェース）。
 *
 * 方針:
 * - 既定は `demo`（決定論的・外部通信なし）。APIキー未設定でも壊れない。
 * - 実LLMは OpenAI 互換の chat completions を想定（社内ゲートウェイも同形式で受けられる）。
 * - 数値・合否はこのモジュールでは扱わない。数値は必ず src/shared/measurements.ts が算出し、
 *   AIの出力は文章（narration）に限定する。
 */

export type AiRole = 'system' | 'user' | 'assistant';
export type AiMessage = { role: AiRole; content: string };
export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiCompletion = {
  text: string;
  provider: string;
  model: string;
  live: boolean;
  usage: AiUsage;
  latencyMs: number;
};

export type AiCallOptions = {
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly live: boolean;
  complete(messages: AiMessage[], options: AiCallOptions): Promise<AiCompletion>;
}

export type AiProviderKind = 'demo' | 'openai';

export type AiConfig = {
  kind: AiProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  maxTokensPerCall: number;
  dailyBudgetTokens: number;
  maxCallsPerMinute: number;
  timeoutMs: number;
};

/** env から設定を読む。キーが無い場合は demo にフォールバックする（起動を止めない）。 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const wantsLive = (env.SAS_AI_PROVIDER ?? 'demo').toLowerCase() === 'openai';
  const apiKey = env.SAS_AI_API_KEY ?? env.OPENAI_API_KEY ?? '';
  const kind: AiProviderKind = wantsLive && apiKey ? 'openai' : 'demo';
  return {
    kind,
    model: env.SAS_AI_MODEL ?? (kind === 'openai' ? 'gpt-4o-mini' : 'demo-deterministic'),
    baseUrl: (env.SAS_AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey,
    maxTokensPerCall: clampInt(env.SAS_AI_MAX_TOKENS, 64, 400, 400),
    dailyBudgetTokens: clampInt(env.SAS_AI_DAILY_BUDGET_TOKENS, 1000, 10_000_000, 200_000),
    maxCallsPerMinute: clampInt(env.SAS_AI_MAX_CALLS_PER_MINUTE, 1, 120, 20),
    timeoutMs: clampInt(env.SAS_AI_TIMEOUT_MS, 1000, 60_000, 15_000),
  };
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const narrationKeys = ['headline', 'notes', 'confidence'] as const;

/**
 * デモプロバイダ。外部へは一切接続せず、入力の事実だけから決定的な文章を返す。
 * 出力は実LLMと同じJSON契約に従うため、上位の検証・監査経路をそのまま検証できる。
 */
export class DemoAiProvider implements AiProvider {
  readonly name = 'demo';
  readonly model: string;
  readonly live = false;

  constructor(model = 'demo-deterministic') {
    this.model = model;
  }

  async complete(messages: AiMessage[], _options: AiCallOptions): Promise<AiCompletion> {
    const started = Date.now();
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const lines = user
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const verdictLine = lines.find((line) => line.startsWith('判定')) ?? '';
    const metrics = lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
    const headline = (verdictLine || metrics[0] || lines[0] || '入力の事実に基づく要約').slice(0, 120);
    const notes = (metrics.length ? metrics : lines.slice(0, 3)).slice(0, 4).map((line) => line.slice(0, 200));
    const text = JSON.stringify({
      headline,
      notes: notes.length ? notes : ['数値と判定は計算エンジンの結果をそのまま使用しています。'],
      confidence: 'high',
    });
    return {
      text,
      provider: this.name,
      model: this.model,
      live: false,
      usage: { inputTokens: Math.ceil(user.length / 4), outputTokens: Math.ceil(text.length / 4) },
      latencyMs: Math.min(Date.now() - started, 1),
    };
  }
}

/** OpenAI 互換 chat completions。タイムアウトと最大トークンを必ず付与する。 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  readonly live = true;
  readonly model: string;
  private readonly config: AiConfig;

  constructor(config: AiConfig) {
    this.config = config;
    this.model = config.model;
  }

  async complete(messages: AiMessage[], options: AiCallOptions): Promise<AiCompletion> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as
        | {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            error?: { message?: string };
          }
        | null;
      if (!res.ok) {
        throw new AiUpstreamError(
          `AI upstream ${res.status}: ${(body?.error?.message ?? '').slice(0, 120)}`,
        );
      }
      const text = body?.choices?.[0]?.message?.content;
      if (!text) throw new AiUpstreamError('AI upstream returned no content');
      return {
        text,
        provider: this.name,
        model: this.model,
        live: true,
        usage: {
          inputTokens: Number(body?.usage?.prompt_tokens ?? 0),
          outputTokens: Number(body?.usage?.completion_tokens ?? 0),
        },
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

export class AiUpstreamError extends Error {
  readonly code = 'AI_UPSTREAM_FAILED';
}

export function createAiProvider(config: AiConfig): AiProvider {
  return config.kind === 'openai'
    ? new OpenAiCompatibleProvider(config)
    : new DemoAiProvider(config.model);
}

export const AI_NARRATION_KEYS = narrationKeys;
