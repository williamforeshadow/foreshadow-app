import Anthropic from '@anthropic-ai/sdk';

// Shared Anthropic client + model id.
//
// Extracted from runAgent.ts so non-agent callers (e.g. the guest-reply draft
// generator in src/server/messages) can reuse the same client and model without
// importing runAgent.ts — importing runAgent would pull in the whole tool
// registry and create a circular dependency (tool → runAgent → tools/index →
// tool). This module imports nothing from the agent, so it's safe everywhere.

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    // Fail loudly with a self-explanatory message. The common cause locally is
    // an EMPTY ANTHROPIC_API_KEY already present in the process environment:
    // dotenv/Next will not override an already-set var, so a valid key in
    // .env.local is ignored. Restart the dev server from a terminal where
    // ANTHROPIC_API_KEY isn't pre-set to empty (so .env.local wins).
    if (!apiKey.trim()) {
      throw new Error(
        'ANTHROPIC_API_KEY is empty or unset in this process. If it is set in .env.local, the dev server likely inherited an empty ANTHROPIC_API_KEY that overrides it (dotenv does not override already-set env vars) — restart `npm run dev` from a clean terminal.',
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Sonnet 4.6 — the production model for tool-grounded ops chat: fast, cheap,
// tight on instruction-following and structured tool use. Shared so the agent
// loop and the draft generator stay on the same model.
export const MODEL = 'claude-sonnet-4-6';
