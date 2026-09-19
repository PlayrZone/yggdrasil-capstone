import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from './IMindBackend.js';
import type { ThinkPrompt } from './prompt.js';

export interface FireworksMindBackendOptions {
  apiKey: string;
  /** Fireworks model id, e.g. 'accounts/fireworks/models/llama-v3p1-8b-instruct'. */
  model: string;
  /** Override for tests / proxies. */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Consciousness backend on Fireworks AI serverless (the Y3 bootstrap rung;
 * the Y4 fine-tuned Yggdrasil model is a config-only swap of `model`).
 * Pure transport: it asks for JSON-object output and returns the raw text;
 * LlmMind validates and retries.
 *
 * Untested live in CI (needs a real key + network). Enable by constructing
 * with an API key and passing the backend to the Observatory runner.
 */
export class FireworksMindBackend implements IMindBackend {
  readonly modelId: string;
  private readonly opts: Required<Omit<FireworksMindBackendOptions, 'fetchImpl'>> & {
    fetchImpl: typeof fetch;
  };

  constructor(options: FireworksMindBackendOptions) {
    this.modelId = options.model;
    this.opts = {
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl ?? 'https://api.fireworks.ai/inference/v1/chat/completions',
      temperature: options.temperature ?? 0.7,
      // Reasoning models (gpt-oss, deepseek) spend tokens on internal
      // reasoning before the JSON; 512 starves them and yields empty
      // content. 2048 leaves room for both → reliable structured output.
      maxTokens: options.maxTokens ?? 2048,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  // Pure transport: `prompt` is already composed (retry feedback included) and
  // is sent verbatim. Rebuilding it here from `_input` is what let the wire and
  // the record disagree; the situation is now unused on purpose.
  async complete(prompt: ThinkPrompt, _input: ThinkInput): Promise<string> {
    const res = await this.opts.fetchImpl(this.opts.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens,
        temperature: this.opts.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Fireworks ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Fireworks: no content in response');
    return content;
  }
}
