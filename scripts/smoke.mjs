// Live smoke test: does the director loop actually work against a real provider?
// Run:  node --env-file=.env smoke.mjs
import { solveProblemDetailed, OpenAICompatClient } from "../packages/board-director/src/index.ts";
import { layoutScript } from "../packages/board-layout/src/index.ts";
import { buildPlan } from "../packages/stroke-engine/src/index.ts";

const PROVIDERS = [
  { name: "groq", baseUrl: "https://api.groq.com/openai/v1",
    key: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
  { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1",
    key: process.env.CEREBRAS_API_KEY, model: "llama-3.3-70b" },
  { name: "openrouter", baseUrl: "https://openrouter.ai/api/v1",
    key: process.env.OPENROUTER_API_KEY, model: "meta-llama/llama-3.3-70b-instruct" },
];

const QUESTION = "Solve the quadratic equation 2x^2 + 5x - 3 = 0. Show each step on the board.";

for (const p of PROVIDERS) {
  if (!p.key) { console.log(`\n### ${p.name}: no key, skipped`); continue; }
  console.log(`\n### ${p.name} (${p.model})`);
  const t0 = Date.now();
  try {
    const client = new OpenAICompatClient({ baseUrl: p.baseUrl, apiKey: p.key, model: p.model });
    const { script, usage } = await solveProblemDetailed(QUESTION, client, {
      scriptId: `smoke-${p.name}`, maxToolCalls: 14, maxTotalTokens: 40000,
    });
    const ms = Date.now() - t0;
    console.log(`  ok  ${script.steps.length} steps | ${usage.toolCalls} tool calls | ` +
      `${usage.inputTokens + usage.outputTokens} tokens | ${(ms / 1000).toFixed(1)}s`);
    for (const s of script.steps) {
      console.log(`    [${s.kind}] ${(s.tex ?? s.text ?? "").slice(0, 60)}`);
    }
    // does it survive the rest of the pipeline?
    const board = { width: 900, height: 520 };
    const plan = buildPlan(layoutScript(script, board), { seed: 1, board });
    const pts = plan.strokes.flatMap((s) => s.points);
    const inBounds = pts.every((q) => q.x >= 0 && q.x <= board.width && q.y >= 0 && q.y <= board.height);
    console.log(`  render: ${plan.strokes.length} strokes, ${plan.pages} page(s), in-bounds: ${inBounds}`);
  } catch (e) {
    console.log(`  FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(e.message).slice(0, 160)}`);
  }
}
