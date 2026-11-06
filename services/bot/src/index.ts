/**
 * Bot service stub. Model clients live behind the ModelClient interface and
 * fixture mode (no network, no cost) is the default. Live clients arrive in
 * a later phase behind the same interface with token/cost logging and a
 * hard per-provider daily cap.
 */

export interface ModelRequest {
  prompt: string;
  maxTokens: number;
}

export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  fixture: boolean;
}

export interface ModelClient {
  readonly mode: "fixture" | "live";
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class FixtureModelClient implements ModelClient {
  readonly mode = "fixture" as const;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return {
      text: `[fixture] draft reply to: ${request.prompt.slice(0, 80)}`,
      inputTokens: 0,
      outputTokens: 0,
      fixture: true,
    };
  }
}

export function defaultClient(): ModelClient {
  return new FixtureModelClient();
}

export * from "./private/gate.js";
