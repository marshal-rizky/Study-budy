import type { DirectorClient, DirectorRequest, DirectorResponse } from "../client";

/**
 * Deterministic, no-network `DirectorClient` for tests. Constructed with a
 * scripted array of responses returned in order; records every request it
 * received so assertions can inspect what the director sent (system prompt,
 * accumulated message history, tool defs).
 */
export class FakeClient implements DirectorClient {
  readonly requests: DirectorRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: DirectorResponse[]) {}

  async createMessage(req: DirectorRequest): Promise<DirectorResponse> {
    this.requests.push(req);
    const response = this.script[Math.min(this.cursor, this.script.length - 1)];
    if (this.cursor < this.script.length - 1) this.cursor++;
    if (!response) {
      throw new Error("FakeClient: script is empty");
    }
    return response;
  }
}
