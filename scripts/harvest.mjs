// Harvest REAL model output to ground the adversarial test corpus.
// Records every tex/text/expr a model emits, and whether it survives the render path.
import { solveProblemDetailed, OpenAICompatClient } from "../packages/board-director/src/index.ts";
import { layoutScript } from "../packages/board-layout/src/index.ts";
import { buildPlan } from "../packages/stroke-engine/src/index.ts";
import fs from "node:fs";

const PROVIDERS = [
  { n: "groq", u: "https://api.groq.com/openai/v1", k: process.env.GROQ_API_KEY, m: "llama-3.3-70b-versatile" },
  { n: "openrouter", u: "https://openrouter.ai/api/v1", k: process.env.OPENROUTER_API_KEY, m: "meta-llama/llama-3.3-70b-instruct" },
];
const QUESTIONS = [
  "Solve 2x^2 + 5x - 3 = 0.",
  "Solve 3x + 7 = 22 step by step.",
  "A ball is thrown up at 20 m/s. How high does it go? Use g = 9.8.",
  "Simplify (x^2 - 9)/(x - 3).",
  "Plot y = x^2 and label the vertex.",
];

// Space requests out so free-tier rate limits don't mask whether the Fix 2 retry/backoff
// change (or the Fix 1 renderability gate) actually works -- a request that never gets
// rate-limited in the first place proves nothing about either fix.
const REQUEST_SPACING_MS = 4000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = [];
let first = true;
for (const p of PROVIDERS) {
  if (!p.k) continue;
  for (const q of QUESTIONS) {
    if (!first) await sleep(REQUEST_SPACING_MS);
    first = false;
    try {
      const client = new OpenAICompatClient({ baseUrl: p.u, apiKey: p.k, model: p.m });
      const { script, stopReason } = await solveProblemDetailed(q, client, {
        scriptId: "h", maxToolCalls: 12, maxTotalTokens: 30000,
      });
      for (const s of script.steps) {
        const raw = s.tex ?? s.text ?? (s.diagram ? JSON.stringify(s.diagram) : "");
        let renders = "n/a";
        try {
          const board = { width: 900, height: 520 };
          buildPlan(layoutScript({ scriptId: "x", steps: [s] }, board), { seed: 1, board });
          renders = "ok";
        } catch (e) { renders = `THROWS: ${e.constructor.name}: ${String(e.message).slice(0, 70)}`; }
        rows.push({ provider: p.n, kind: s.kind, raw, renders });
      }
      console.log(`${p.n} | ${q.slice(0, 30)} | ${script.steps.length} steps | ${stopReason ?? "?"}`);
    } catch (e) {
      console.log(`${p.n} | ${q.slice(0, 30)} | ERROR ${String(e.message).slice(0, 80)}`);
    }
  }
}
fs.writeFileSync("harvest.json", JSON.stringify(rows, null, 2));
const bad = rows.filter((r) => r.renders !== "ok");
console.log(`\n=== ${rows.length} steps harvested, ${bad.length} FAIL to render ===`);
for (const b of bad) console.log(`  [${b.kind}] ${b.raw.slice(0, 70)}\n      ${b.renders}`);
