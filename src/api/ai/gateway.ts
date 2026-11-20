/**
 * AIゲートウェイ: 出力契約・コスト・レートの統制。
 *
 * 安全境界（重要）:
 * - このモジュールは数値を算出しない。入力の事実（計算エンジンの結果）を文章化させるだけ。
 * - 出力はJSONスキーマで検証し、契約外は拒否する（AI_OUTPUT_INVALID）。
 * - 1日のトークン予算と毎分の呼び出し上限を超えたら拒否する（費用の暴走防止）。
 */

import { z } from 'zod';
import type { AiConfig, AiCompletion, AiMessage, AiProvider } from './provider';
import { AiUpstreamError } from './provider';

export const narrationSchema = z.object({
  headline: z.string().trim().min(4).max(160),
  notes: z.array(z.string().trim().min(2).max(240)).min(1).max(4),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export type Narration = z.infer<typeof narrationSchema>;

export type AiErrorCode =
  | 'AI_BUDGET_EXCEEDED'
  | 'AI_RATE_LIMITED'
  | 'AI_OUTPUT_INVALID'
  | 'AI_UPSTREAM_FAILED';

export class AiPolicyError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type NarrationInput = {
  siteName: string;
  task: string;
  verdict: string;
  metrics: Array<{ label: string; value: string }>;
};

export type NarrationResult = {
  narration: Narration;
  meta: {
    provider: string;
    model: string;
    live: boolean;
    usage: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    callsToday: number;
    tokensToday: number;
  };
};

const SYSTEM_PROMPT = [
  'あなたは土木施工管理の補助AIです。',
  '与えられた事実だけを述べ、数値の計算・合否の判定・推測を行わないでください。',
  '数値は入力に書かれたものを引用するだけにしてください。',
  '必ず次のJSONのみを返してください: {"headline": string(4-160文字), "notes": string[](1-4件, 各2-240文字), "confidence": "high"|"medium"|"low"(任意)}',
].join('\n');

export class AiGateway {
  private callTimestampsMs: number[] = [];
  private tokensToday = 0;
  private dayKey: string;
  private totalCalls = 0;

  constructor(
    private readonly provider: AiProvider,
    private readonly config: AiConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.dayKey = this.todayKey();
  }

  private todayKey(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private rollover(): void {
    const key = this.todayKey();
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.tokensToday = 0;
    }
  }

  usage(): { callsToday: number; tokensToday: number; budget: number; provider: string; model: string; live: boolean } {
    this.rollover();
    return {
      callsToday: this.totalCalls,
      tokensToday: this.tokensToday,
      budget: this.config.dailyBudgetTokens,
      provider: this.provider.name,
      model: this.provider.model,
      live: this.provider.live,
    };
  }

  private assertQuota(): void {
    this.rollover();
    const now = this.now();
    this.callTimestampsMs = this.callTimestampsMs.filter((t) => now - t < 60_000);
    if (this.callTimestampsMs.length >= this.config.maxCallsPerMinute) {
      throw new AiPolicyError(
        'AI_RATE_LIMITED',
        `AI呼び出しが上限（${this.config.maxCallsPerMinute}回/分）に達しました。少し待って再試行してください。`,
      );
    }
    // 最悪ケース（入力+最大出力）で予算を超えるなら実行しない
    const worstCase = this.config.maxTokensPerCall;
    if (this.tokensToday + worstCase > this.config.dailyBudgetTokens) {
      throw new AiPolicyError(
        'AI_BUDGET_EXCEEDED',
        `本日のAIトークン予算（${this.config.dailyBudgetTokens}）に達する見込みです。明日以降に再試行してください。`,
      );
    }
  }

  async narrate(input: NarrationInput): Promise<NarrationResult> {
    this.assertQuota();
    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `現場: ${input.siteName}`,
          `タスク: ${input.task}`,
          `判定（計算エンジンの結果）: ${input.verdict}`,
          '指標（計算エンジンの結果。引用のみ可）:',
          ...input.metrics.map((m) => `- ${m.label}: ${m.value}`),
          'この事実だけを使って、現場責任者向けの要約を作成してください。',
        ].join('\n'),
      },
    ];

    let completion: AiCompletion;
    try {
      completion = await this.provider.complete(messages, {
        maxTokens: this.config.maxTokensPerCall,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      if (error instanceof AiUpstreamError) {
        throw new AiPolicyError('AI_UPSTREAM_FAILED', 'AIプロバイダに接続できませんでした。');
      }
      throw error;
    }

    this.callTimestampsMs.push(this.now());
    this.totalCalls += 1;
    this.tokensToday += completion.usage.inputTokens + completion.usage.outputTokens;

    const parsed = parseNarration(completion.text);
    return {
      narration: parsed,
      meta: {
        provider: completion.provider,
        model: completion.model,
        live: completion.live,
        usage: completion.usage,
        latencyMs: completion.latencyMs,
        callsToday: this.totalCalls,
        tokensToday: this.tokensToday,
      },
    };
  }
}

/** AI出力をJSONとして読み、契約に適合するか検証する（契約外は拒否）。 */
export function parseNarration(text: string): Narration {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiPolicyError('AI_OUTPUT_INVALID', 'AIの出力がJSONではありません。');
  }
  const result = narrationSchema.safeParse(json);
  if (!result.success) {
    throw new AiPolicyError('AI_OUTPUT_INVALID', 'AIの出力が契約（headline/notes）に適合しません。');
  }
  return result.data;
}
