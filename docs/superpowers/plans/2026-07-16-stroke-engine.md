# Stroke Engine (AI Teacher Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone TypeScript stroke engine that turns TeX-subset math, plain text, and diagram commands into animated, hand-drawn-looking pen strokes on a canvas, with a demo web page.

**Architecture:** Pure-TS library (`packages/stroke-engine`) with pre-baked glyph stroke library (Hershey single-stroke font data + hand-authored math symbols), seeded jitter, TeX-subset parser → layout tree → positioned glyph strokes, diagram primitives, and a timed render plan consumed by a canvas player. React demo app (`apps/web`) renders the animation. No AI, no backend — this retires the "does it look like real handwriting?" risk (spec §8 P1).

**Tech Stack:** TypeScript (strict), npm workspaces, Vitest, Vite + React 18, `hersheytext` (dev-time glyph data source only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-ai-teacher-design.md` (§4.1 StrokeEngine, §8 P1)
- TypeScript `strict: true` everywhere
- `packages/stroke-engine` has **zero runtime dependencies** (pure TS; `hersheytext` is a devDependency used only by a build script)
- All randomness goes through the seeded RNG — same seed ⇒ byte-identical output (needed for snapshot tests and future replay)
- Glyph coordinate convention: **em units, baseline at y=0, y increases downward, cap height ≈ 0.7 em** (documented in `types.ts`)
- Node 20+, npm workspaces (root `package.json` private)
- Visual regression = deterministic JSON stroke snapshots (Vitest snapshots), not PNG diffs — same intent as spec §7, simpler and CI-stable. Manual visual check via demo page.

---

### Task 1: Workspace scaffold + stroke-engine package

**Files:**
- Create: `package.json` (root)
- Create: `packages/stroke-engine/package.json`
- Create: `packages/stroke-engine/tsconfig.json`
- Create: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: workspace layout; `@teacher/stroke-engine` package importable; `npm test -w @teacher/stroke-engine` runs Vitest

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "teacher",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm test -w @teacher/stroke-engine"
  }
}
```

- [ ] **Step 2: Create packages/stroke-engine/package.json**

```json
{
  "name": "@teacher/stroke-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build-glyphs": "node scripts/build-glyphs.mjs"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "hersheytext": "^4.0.2"
  }
}
```

- [ ] **Step 3: Create packages/stroke-engine/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 4: Create src/index.ts (empty barrel) and smoke test**

`src/index.ts`:
```ts
export const ENGINE_VERSION = "0.1.0";
```

`src/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("smoke", () => {
  it("package loads", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 5: Install and run test**

Run (repo root): `npm install` then `npm test`
Expected: 1 test PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/stroke-engine package-lock.json
git commit -m "feat: workspace scaffold with stroke-engine package"
```

---

### Task 2: Core types + seeded RNG

**Files:**
- Create: `packages/stroke-engine/src/types.ts`
- Create: `packages/stroke-engine/src/rng.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/rng.test.ts`

**Interfaces:**
- Produces:
  - `interface Point { x: number; y: number }`
  - `type Stroke = Point[]`
  - `interface GlyphDef { advance: number; strokes: Stroke[] }`
  - `function mulberry32(seed: number): () => number` — deterministic PRNG returning floats in `[0, 1)`
  - `function strokeLength(s: Stroke): number`

- [ ] **Step 1: Write failing tests**

`src/rng.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { strokeLength } from "./types";

describe("mulberry32", () => {
  it("same seed gives same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("different seeds differ", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("outputs in [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("strokeLength", () => {
  it("sums segment lengths", () => {
    expect(strokeLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 5 }])).toBeCloseTo(6);
  });
  it("returns 0 for a single point", () => {
    expect(strokeLength([{ x: 1, y: 1 }])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./rng`.

- [ ] **Step 3: Implement**

`src/types.ts`:
```ts
/**
 * Glyph coordinate convention (whole engine):
 * - em units; font size in px is applied at realization time
 * - baseline at y = 0, y increases DOWNWARD (canvas convention)
 * - cap height ≈ 0.7 em (so 'H' spans y ∈ [-0.7, 0]); descenders go below (y > 0)
 */
export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

/** One pre-baked glyph: ordered pen strokes in em units + horizontal advance. */
export interface GlyphDef {
  advance: number;
  strokes: Stroke[];
}

export function strokeLength(s: Stroke): number {
  let len = 0;
  for (let i = 1; i < s.length; i++) {
    len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  return len;
}
```

`src/rng.ts`:
```ts
/** Deterministic 32-bit PRNG (mulberry32). Same seed => same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`src/index.ts` (replace contents):
```ts
export const ENGINE_VERSION = "0.1.0";
export * from "./types";
export * from "./rng";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: core geometry types and seeded RNG"
```

---

### Task 3: Hershey glyph build script + library loader

**Files:**
- Create: `packages/stroke-engine/scripts/build-glyphs.mjs`
- Create: `packages/stroke-engine/src/glyphs/hershey.json` (generated)
- Create: `packages/stroke-engine/src/glyphs/library.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/glyphs/library.test.ts`

**Interfaces:**
- Consumes: `GlyphDef`, `Stroke` from Task 2
- Produces:
  - `function getGlyph(char: string): GlyphDef | undefined`
  - `const FALLBACK_GLYPH: GlyphDef` — small rectangle drawn for unknown chars
  - `hershey.json` format: `Record<string, { advance: number; strokes: [number, number][][] }>` (pairs, not `{x,y}`, to keep JSON small)

- [ ] **Step 1: Write the build script**

`scripts/build-glyphs.mjs`:
```js
// Converts Hershey single-stroke font data (hersheytext package, public-domain
// Hershey fonts) into our GlyphDef JSON. Run: npm run build-glyphs -w @teacher/stroke-engine
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hershey = require("hersheytext");
const FONT = "futural"; // "Sans 1-stroke"
const font = hershey.fonts[FONT];
if (!font) {
  console.error(`Font ${FONT} not found. Available:`, Object.keys(hershey.fonts).join(", "));
  process.exit(1);
}
// hersheytext chars are indexed from ASCII 33 ('!'). Each entry has an SVG
// path `d` containing only M/L commands, and `o` = horizontal advance.
const chars = font.chars;

function parseStrokes(d) {
  const strokes = [];
  let current = null;
  const re = /([ML])\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    const [, cmd, xs, ys] = m;
    const pt = [parseFloat(xs), parseFloat(ys)];
    if (cmd === "M") {
      current = [pt];
      strokes.push(current);
    } else if (current) {
      current.push(pt);
    }
  }
  return strokes.filter((s) => s.length >= 2);
}

// Calibrate scale/baseline from 'H' (index 72-33): cap top -> -0.7em, bottom -> baseline 0.
const H = chars[72 - 33];
const hStrokes = parseStrokes(H.d);
const hYs = hStrokes.flat().map((p) => p[1]);
const capTop = Math.min(...hYs);
const baseline = Math.max(...hYs);
const scale = 0.7 / (baseline - capTop);

const out = {};
for (let i = 0; i < chars.length; i++) {
  const ch = String.fromCharCode(33 + i);
  const entry = chars[i];
  if (!entry || !entry.d) continue;
  const raw = parseStrokes(entry.d);
  if (raw.length === 0) continue;
  const xs = raw.flat().map((p) => p[0]);
  const left = Math.min(...xs);
  const strokes = raw.map((s) =>
    s.map(([x, y]) => [
      Math.round((x - left) * scale * 1e4) / 1e4,
      Math.round((y - baseline) * scale * 1e4) / 1e4,
    ])
  );
  const advance = Math.round((parseFloat(entry.o) * scale + 0.1) * 1e4) / 1e4;
  out[ch] = { advance, strokes };
}
// space is not in Hershey data
out[" "] = { advance: 0.45, strokes: [] };

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/glyphs/hershey.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} glyphs to ${dest}`);
```

- [ ] **Step 2: Run the script and sanity-check output**

Run: `npm run build-glyphs -w @teacher/stroke-engine`
Expected: `Wrote ~95 glyphs to .../src/glyphs/hershey.json` (94 printable ASCII + space; exact count may vary by one or two).
If the `hersheytext` data shape differs from `chars[i].d`/`chars[i].o`, inspect with `node -e "console.log(Object.keys(require('hersheytext').fonts))"` and adapt the two accessor lines — the rest of the script is shape-independent.

- [ ] **Step 3: Write failing loader test**

`src/glyphs/library.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getGlyph, FALLBACK_GLYPH } from "./library";

describe("glyph library", () => {
  it("has core ASCII glyphs", () => {
    for (const ch of ["A", "x", "2", "+", "=", "(", ")"]) {
      const g = getGlyph(ch);
      expect(g, `missing glyph ${ch}`).toBeDefined();
      expect(g!.strokes.length).toBeGreaterThan(0);
      expect(g!.advance).toBeGreaterThan(0);
    }
  });
  it("space has advance but no strokes", () => {
    const g = getGlyph(" ")!;
    expect(g.strokes).toHaveLength(0);
    expect(g.advance).toBeGreaterThan(0);
  });
  it("glyphs are normalized: baseline ~0, cap height ~0.7", () => {
    const H = getGlyph("H")!;
    const ys = H.strokes.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(0, 1);
    expect(Math.min(...ys)).toBeCloseTo(-0.7, 1);
  });
  it("unknown char returns undefined; fallback exists", () => {
    expect(getGlyph("☃")).toBeUndefined();
    expect(FALLBACK_GLYPH.strokes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./library`.

- [ ] **Step 5: Implement loader**

`src/glyphs/library.ts`:
```ts
import type { GlyphDef, Stroke } from "../types";
import hersheyJson from "./hershey.json";

type JsonGlyph = { advance: number; strokes: [number, number][][] };

function toGlyph(j: JsonGlyph): GlyphDef {
  const strokes: Stroke[] = j.strokes.map((s) => s.map(([x, y]) => ({ x, y })));
  return { advance: j.advance, strokes };
}

const lib = new Map<string, GlyphDef>();
for (const [ch, j] of Object.entries(hersheyJson as Record<string, JsonGlyph>)) {
  lib.set(ch, toGlyph(j));
}

/** Drawn when a char has no glyph: a small open box on the baseline. */
export const FALLBACK_GLYPH: GlyphDef = {
  advance: 0.7,
  strokes: [[
    { x: 0.05, y: 0 }, { x: 0.05, y: -0.6 }, { x: 0.55, y: -0.6 },
    { x: 0.55, y: 0 }, { x: 0.05, y: 0 },
  ]],
};

export function getGlyph(char: string): GlyphDef | undefined {
  return lib.get(char);
}

/** Register/override a glyph (used by overrides module and future ML swap-in). */
export function registerGlyph(char: string, def: GlyphDef): void {
  lib.set(char, def);
}
```

Add to `src/index.ts`:
```ts
export { getGlyph, registerGlyph, FALLBACK_GLYPH } from "./glyphs/library";
```

- [ ] **Step 6: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/stroke-engine/scripts packages/stroke-engine/src
git commit -m "feat: Hershey-derived glyph library with loader"
```

---

### Task 4: Hand-authored math glyph overrides

**Files:**
- Create: `packages/stroke-engine/src/glyphs/overrides.ts`
- Modify: `packages/stroke-engine/src/glyphs/library.ts`
- Test: `packages/stroke-engine/src/glyphs/overrides.test.ts`

**Interfaces:**
- Consumes: `GlyphDef`, `registerGlyph` from Task 3
- Produces: glyphs for `√ ∫ Σ π θ Δ × ÷ ± → ≠ ≤ ≥ ≈ ⇌` available via `getGlyph`

- [ ] **Step 1: Write failing test**

`src/glyphs/overrides.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getGlyph } from "./library";

const MATH_CHARS = ["√", "∫", "Σ", "π", "θ", "Δ", "×", "÷", "±", "→", "≠", "≤", "≥", "≈", "⇌"];

describe("math glyph overrides", () => {
  it.each(MATH_CHARS)("has glyph %s", (ch) => {
    const g = getGlyph(ch);
    expect(g).toBeDefined();
    expect(g!.strokes.length).toBeGreaterThan(0);
    expect(g!.advance).toBeGreaterThan(0);
    // sane bounds: within roughly one em box around the baseline
    for (const p of g!.strokes.flat()) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.2);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.2);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — glyphs undefined.

- [ ] **Step 3: Implement overrides**

`src/glyphs/overrides.ts`:
```ts
import type { GlyphDef, Stroke } from "../types";

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 16): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

const dot = (x: number, y: number): Stroke => [
  { x, y }, { x: x + 0.03, y: y + 0.02 },
];

/** Hand-authored single-stroke math glyphs. Em units, baseline y=0, y down. */
export const overrides: Record<string, GlyphDef> = {
  "√": { advance: 0.9, strokes: [[
    { x: 0.05, y: -0.3 }, { x: 0.18, y: -0.05 }, { x: 0.4, y: -0.78 }, { x: 0.85, y: -0.78 },
  ]] },
  "∫": { advance: 0.5, strokes: [[
    { x: 0.42, y: -0.82 }, { x: 0.34, y: -0.9 }, { x: 0.26, y: -0.8 },
    { x: 0.26, y: 0.1 }, { x: 0.18, y: 0.2 }, { x: 0.1, y: 0.12 },
  ]] },
  "Σ": { advance: 0.7, strokes: [[
    { x: 0.6, y: -0.7 }, { x: 0.05, y: -0.7 }, { x: 0.35, y: -0.35 },
    { x: 0.05, y: 0 }, { x: 0.6, y: 0 },
  ]] },
  "π": { advance: 0.75, strokes: [
    [{ x: 0.02, y: -0.46 }, { x: 0.72, y: -0.5 }],
    [{ x: 0.2, y: -0.46 }, { x: 0.17, y: 0 }],
    [{ x: 0.52, y: -0.46 }, { x: 0.55, y: -0.06 }, { x: 0.63, y: 0 }],
  ] },
  "θ": { advance: 0.6, strokes: [
    ellipse(0.28, -0.35, 0.2, 0.37),
    [{ x: 0.1, y: -0.35 }, { x: 0.46, y: -0.35 }],
  ] },
  "Δ": { advance: 0.8, strokes: [[
    { x: 0.4, y: -0.7 }, { x: 0.05, y: 0 }, { x: 0.75, y: 0 }, { x: 0.4, y: -0.7 },
  ]] },
  "×": { advance: 0.6, strokes: [
    [{ x: 0.08, y: -0.5 }, { x: 0.5, y: -0.08 }],
    [{ x: 0.5, y: -0.5 }, { x: 0.08, y: -0.08 }],
  ] },
  "÷": { advance: 0.6, strokes: [
    [{ x: 0.06, y: -0.3 }, { x: 0.54, y: -0.3 }],
    dot(0.28, -0.5),
    dot(0.28, -0.1),
  ] },
  "±": { advance: 0.6, strokes: [
    [{ x: 0.3, y: -0.6 }, { x: 0.3, y: -0.2 }],
    [{ x: 0.08, y: -0.4 }, { x: 0.52, y: -0.4 }],
    [{ x: 0.08, y: -0.02 }, { x: 0.52, y: -0.02 }],
  ] },
  "→": { advance: 0.9, strokes: [
    [{ x: 0.05, y: -0.3 }, { x: 0.8, y: -0.3 }],
    [{ x: 0.62, y: -0.45 }, { x: 0.8, y: -0.3 }, { x: 0.62, y: -0.15 }],
  ] },
  "≠": { advance: 0.65, strokes: [
    [{ x: 0.08, y: -0.4 }, { x: 0.56, y: -0.4 }],
    [{ x: 0.08, y: -0.2 }, { x: 0.56, y: -0.2 }],
    [{ x: 0.44, y: -0.58 }, { x: 0.2, y: -0.02 }],
  ] },
  "≤": { advance: 0.65, strokes: [
    [{ x: 0.55, y: -0.6 }, { x: 0.08, y: -0.36 }, { x: 0.55, y: -0.14 }],
    [{ x: 0.08, y: 0 }, { x: 0.55, y: 0 }],
  ] },
  "≥": { advance: 0.65, strokes: [
    [{ x: 0.08, y: -0.6 }, { x: 0.55, y: -0.36 }, { x: 0.08, y: -0.14 }],
    [{ x: 0.08, y: 0 }, { x: 0.55, y: 0 }],
  ] },
  "≈": { advance: 0.65, strokes: [
    [{ x: 0.06, y: -0.38 }, { x: 0.2, y: -0.46 }, { x: 0.4, y: -0.32 }, { x: 0.56, y: -0.42 }],
    [{ x: 0.06, y: -0.16 }, { x: 0.2, y: -0.24 }, { x: 0.4, y: -0.1 }, { x: 0.56, y: -0.2 }],
  ] },
  "⇌": { advance: 0.95, strokes: [
    [{ x: 0.06, y: -0.42 }, { x: 0.85, y: -0.42 }],
    [{ x: 0.68, y: -0.56 }, { x: 0.85, y: -0.42 }],
    [{ x: 0.06, y: -0.22 }, { x: 0.85, y: -0.22 }],
    [{ x: 0.23, y: -0.08 }, { x: 0.06, y: -0.22 }],
  ] },
};
```

Modify `src/glyphs/library.ts` — after the Hershey loading loop, add:
```ts
import { overrides } from "./overrides";
// (place import at top of file with the others)

for (const [ch, def] of Object.entries(overrides)) {
  lib.set(ch, def);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src/glyphs
git commit -m "feat: hand-authored math glyph overrides"
```

---

### Task 5: Jitter module

**Files:**
- Create: `packages/stroke-engine/src/jitter.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/jitter.test.ts`

**Interfaces:**
- Consumes: `Point`, `Stroke`, `mulberry32`
- Produces: `function jitterStroke(stroke: Stroke, rng: () => number, amount: number, step?: number): Stroke` — resamples the polyline at `step` spacing (default 0.06 em-equivalent in whatever units the stroke is in) and applies smoothed random perpendicular displacement bounded by `amount`.

- [ ] **Step 1: Write failing tests**

`src/jitter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { jitterStroke } from "./jitter";
import { mulberry32 } from "./rng";
import type { Stroke } from "./types";

const line: Stroke = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

describe("jitterStroke", () => {
  it("is deterministic for the same seed", () => {
    const a = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    const b = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    expect(a).toEqual(b);
  });
  it("differs across seeds", () => {
    const a = jitterStroke(line, mulberry32(1), 0.3, 0.5);
    const b = jitterStroke(line, mulberry32(2), 0.3, 0.5);
    expect(a).not.toEqual(b);
  });
  it("displacement is bounded by amount", () => {
    const out = jitterStroke(line, mulberry32(42), 0.3, 0.5);
    for (const p of out) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(-0.3 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(10.3 + 1e-9);
    }
  });
  it("resamples: output has more points than a 2-point input", () => {
    const out = jitterStroke(line, mulberry32(42), 0.1, 0.5);
    expect(out.length).toBeGreaterThan(10);
  });
  it("keeps short strokes intact (no crash on dots)", () => {
    const dotStroke: Stroke = [{ x: 0, y: 0 }, { x: 0.01, y: 0.01 }];
    const out = jitterStroke(dotStroke, mulberry32(42), 0.3, 0.5);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./jitter`.

- [ ] **Step 3: Implement**

`src/jitter.ts`:
```ts
import type { Point, Stroke } from "./types";
import { strokeLength } from "./types";

/** Resample a polyline to points spaced ~`step` apart (arc-length parametrized). */
export function resample(stroke: Stroke, step: number): Stroke {
  const total = strokeLength(stroke);
  if (total === 0 || stroke.length < 2) return stroke.slice();
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const out: Stroke = [stroke[0]];
  let target = total / (n - 1);
  let acc = 0;
  let i = 1;
  let prev = stroke[0];
  while (i < stroke.length && out.length < n - 1) {
    const cur = stroke[i];
    const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (acc + seg >= target) {
      const t = (target - acc) / seg;
      const p = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(p);
      prev = p;
      acc = 0;
      target = total / (n - 1);
    } else {
      acc += seg;
      prev = cur;
      i++;
    }
  }
  out.push(stroke[stroke.length - 1]);
  return out;
}

/**
 * Hand-tremor jitter: resample, then displace each point by smoothed noise.
 * Deterministic given the rng. Displacement per axis is bounded by `amount`.
 */
export function jitterStroke(
  stroke: Stroke,
  rng: () => number,
  amount: number,
  step = 0.06
): Stroke {
  const pts = resample(stroke, step);
  if (pts.length < 2 || amount === 0) return pts;
  // raw noise per point
  const raw: Point[] = pts.map(() => ({
    x: (rng() * 2 - 1) * amount,
    y: (rng() * 2 - 1) * amount,
  }));
  // moving-average smoothing (window 3) keeps wobble low-frequency, like a wrist
  const out: Stroke = pts.map((p, idx) => {
    const a = raw[Math.max(0, idx - 1)];
    const b = raw[idx];
    const c = raw[Math.min(raw.length - 1, idx + 1)];
    return {
      x: p.x + (a.x + b.x + c.x) / 3,
      y: p.y + (a.y + b.y + c.y) / 3,
    };
  });
  return out;
}
```

Add to `src/index.ts`:
```ts
export { jitterStroke, resample } from "./jitter";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: seeded hand-tremor jitter with resampling"
```

---

### Task 6: TeX-subset parser

**Files:**
- Create: `packages/stroke-engine/src/math/parser.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/math/parser.test.ts`

**Interfaces:**
- Produces:
  - AST types:
    ```ts
    type MathNode =
      | { type: "row"; children: MathNode[] }
      | { type: "sym"; char: string }
      | { type: "frac"; num: MathNode; den: MathNode }
      | { type: "sqrt"; body: MathNode }
      | { type: "sup"; base: MathNode; exp: MathNode }
      | { type: "sub"; base: MathNode; sub: MathNode };
    ```
  - `function parseMath(tex: string): MathNode` — throws `MathParseError` (with `.position`) on invalid input
  - Supported: literal chars, `\frac{}{}`, `\sqrt{}`, `^`/`_` (with `{...}` or single-char argument), symbol commands: `\pi \theta \Delta \int \sum \times \div \pm \to \ne \le \ge \approx \rightleftharpoons` (map to the Task 4 glyph chars)

- [ ] **Step 1: Write failing tests**

`src/math/parser.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseMath, MathParseError } from "./parser";

describe("parseMath", () => {
  it("parses a plain row", () => {
    const ast = parseMath("2x+3=7");
    expect(ast).toEqual({
      type: "row",
      children: ["2", "x", "+", "3", "=", "7"].map((c) => ({ type: "sym", char: c })),
    });
  });
  it("parses \\frac", () => {
    const ast = parseMath("\\frac{x+1}{2}");
    expect(ast.type).toBe("row");
    const frac = (ast as any).children[0];
    expect(frac.type).toBe("frac");
    expect(frac.num.children).toHaveLength(3);
    expect(frac.den.children).toHaveLength(1);
  });
  it("parses superscript with braces and without", () => {
    const a = parseMath("x^{2}") as any;
    const b = parseMath("x^2") as any;
    expect(a.children[0].type).toBe("sup");
    expect(b.children[0].type).toBe("sup");
    expect(b.children[0].exp.children[0].char).toBe("2");
  });
  it("parses subscript", () => {
    const ast = parseMath("v_0") as any;
    expect(ast.children[0].type).toBe("sub");
  });
  it("parses \\sqrt and nesting", () => {
    const ast = parseMath("\\sqrt{\\frac{1}{2}}") as any;
    expect(ast.children[0].type).toBe("sqrt");
    expect(ast.children[0].body.children[0].type).toBe("frac");
  });
  it("maps symbol commands", () => {
    const ast = parseMath("\\pi\\theta\\times\\to") as any;
    expect(ast.children.map((c: any) => c.char)).toEqual(["π", "θ", "×", "→"]);
  });
  it("throws on unknown command with position", () => {
    try {
      parseMath("1+\\bogus{2}");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MathParseError);
      expect((e as MathParseError).position).toBe(2);
    }
  });
  it("throws on unbalanced braces", () => {
    expect(() => parseMath("\\frac{1}{2")).toThrow(MathParseError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./parser`.

- [ ] **Step 3: Implement**

`src/math/parser.ts`:
```ts
export type MathNode =
  | { type: "row"; children: MathNode[] }
  | { type: "sym"; char: string }
  | { type: "frac"; num: MathNode; den: MathNode }
  | { type: "sqrt"; body: MathNode }
  | { type: "sup"; base: MathNode; exp: MathNode }
  | { type: "sub"; base: MathNode; sub: MathNode };

export class MathParseError extends Error {
  constructor(message: string, public position: number) {
    super(`${message} (at ${position})`);
    this.name = "MathParseError";
  }
}

const SYMBOL_COMMANDS: Record<string, string> = {
  pi: "π", theta: "θ", Delta: "Δ", int: "∫", sum: "Σ",
  times: "×", div: "÷", pm: "±", to: "→", ne: "≠",
  le: "≤", ge: "≥", approx: "≈", rightleftharpoons: "⇌",
};

class Parser {
  pos = 0;
  constructor(private src: string) {}

  parse(): MathNode {
    const row = this.parseRow(null);
    if (this.pos < this.src.length) {
      throw new MathParseError(`unexpected '${this.src[this.pos]}'`, this.pos);
    }
    return row;
  }

  /** Parse until `until` char (not consumed here) or end of input. */
  private parseRow(until: string | null): MathNode {
    const children: MathNode[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (until !== null && ch === until) break;
      if (ch === "^" || ch === "_") {
        if (children.length === 0) throw new MathParseError(`'${ch}' with no base`, this.pos);
        this.pos++;
        const arg = this.parseArg();
        const base = children.pop()!;
        children.push(
          ch === "^" ? { type: "sup", base, exp: arg } : { type: "sub", base, sub: arg }
        );
        continue;
      }
      children.push(this.parseAtom());
    }
    return { type: "row", children };
  }

  /** `{...}` group or a single atom (for `x^2`, `\sqrt2` style args). */
  private parseArg(): MathNode {
    if (this.src[this.pos] === "{") return this.parseGroup();
    return { type: "row", children: [this.parseAtom()] };
  }

  private parseGroup(): MathNode {
    const start = this.pos;
    this.pos++; // consume {
    const row = this.parseRow("}");
    if (this.src[this.pos] !== "}") throw new MathParseError("unbalanced '{'", start);
    this.pos++; // consume }
    return row;
  }

  private parseAtom(): MathNode {
    const ch = this.src[this.pos];
    if (ch === "{") return this.parseGroup();
    if (ch === "}") throw new MathParseError("unexpected '}'", this.pos);
    if (ch === "\\") return this.parseCommand();
    if (ch === " ") {
      this.pos++;
      return { type: "sym", char: " " };
    }
    this.pos++;
    return { type: "sym", char: ch };
  }

  private parseCommand(): MathNode {
    const start = this.pos;
    this.pos++; // consume backslash
    let name = "";
    while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
      name += this.src[this.pos++];
    }
    if (name === "frac") {
      const num = this.parseArg();
      const den = this.parseArg();
      return { type: "frac", num, den };
    }
    if (name === "sqrt") {
      return { type: "sqrt", body: this.parseArg() };
    }
    const sym = SYMBOL_COMMANDS[name];
    if (sym) return { type: "sym", char: sym };
    throw new MathParseError(`unknown command \\${name}`, start);
  }
}

export function parseMath(tex: string): MathNode {
  return new Parser(tex).parse();
}
```

Add to `src/index.ts`:
```ts
export { parseMath, MathParseError } from "./math/parser";
export type { MathNode } from "./math/parser";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: TeX-subset math parser"
```

---

### Task 7: Math layout engine

**Files:**
- Create: `packages/stroke-engine/src/math/layout.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/math/layout.test.ts`

**Interfaces:**
- Consumes: `MathNode` (Task 6), `getGlyph` (Task 3)
- Produces:
  ```ts
  interface GlyphPlacement { char: string; x: number; y: number; scale: number }
  interface LineSeg { x1: number; y1: number; x2: number; y2: number }
  interface MathLayout {
    placements: GlyphPlacement[];
    lines: LineSeg[];       // fraction bars, sqrt vinculum — drawn as strokes later
    width: number;          // em units
    ascent: number;         // em above baseline (positive number)
    descent: number;        // em below baseline (positive number)
  }
  function layoutMath(node: MathNode, scale?: number): MathLayout
  function layoutText(text: string, scale?: number): MathLayout  // plain row, no parsing
  ```
- Layout constants: math axis `-0.26`, script scale `0.6`, sup baseline shift `-0.42`, sub shift `+0.18`, frac gap `0.1`, binary-op side pad `0.12` — all × current scale.

- [ ] **Step 1: Write failing tests**

`src/math/layout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { layoutMath, layoutText } from "./layout";
import { parseMath } from "./parser";

describe("layoutMath", () => {
  it("lays a row on the baseline, advancing x", () => {
    const l = layoutMath(parseMath("2x"));
    expect(l.placements).toHaveLength(2);
    expect(l.placements[0].y).toBe(0);
    expect(l.placements[1].y).toBe(0);
    expect(l.placements[1].x).toBeGreaterThan(l.placements[0].x);
    expect(l.width).toBeGreaterThan(0);
  });
  it("pads binary operators", () => {
    const noOp = layoutMath(parseMath("22"));
    const withOp = layoutMath(parseMath("2+2"));
    const plusGlyphWidth = layoutMath(parseMath("+")).width;
    // '2+2' should be wider than '22' by more than the bare '+' width (side pads)
    expect(withOp.width).toBeGreaterThan(noOp.width + plusGlyphWidth - 0.01);
  });
  it("fraction: numerator above bar, denominator below", () => {
    const l = layoutMath(parseMath("\\frac{1}{2}"));
    const [num, den] = l.placements;
    expect(num.char).toBe("1");
    expect(den.char).toBe("2");
    expect(num.y).toBeLessThan(-0.26); // above math axis (y is down)
    expect(den.y).toBeGreaterThan(-0.26);
    expect(l.lines).toHaveLength(1); // the bar
    expect(l.lines[0].y1).toBeCloseTo(-0.26, 5);
    expect(l.ascent).toBeGreaterThan(0.8); // taller than a plain row
  });
  it("superscript is raised and shrunk", () => {
    const l = layoutMath(parseMath("x^2"));
    const [base, exp] = l.placements;
    expect(exp.scale).toBeCloseTo(0.6, 5);
    expect(exp.y).toBeLessThan(base.y);
  });
  it("subscript is lowered and shrunk", () => {
    const l = layoutMath(parseMath("v_0"));
    const [, sub] = l.placements;
    expect(sub.scale).toBeCloseTo(0.6, 5);
    expect(sub.y).toBeGreaterThan(0);
  });
  it("sqrt: vinculum spans the body, radical glyph placed", () => {
    const l = layoutMath(parseMath("\\sqrt{xy}"));
    const radical = l.placements.find((p) => p.char === "√");
    expect(radical).toBeDefined();
    expect(l.lines).toHaveLength(1);
    const bar = l.lines[0];
    expect(bar.x2 - bar.x1).toBeGreaterThan(0.5); // covers two glyphs
    expect(bar.y1).toBeLessThan(-0.6); // above the body
  });
  it("unknown glyph char still occupies space", () => {
    const l = layoutMath(parseMath("☃"));
    expect(l.width).toBeGreaterThan(0);
  });
});

describe("layoutText", () => {
  it("lays out plain text without TeX parsing", () => {
    const l = layoutText("Solve:");
    expect(l.placements).toHaveLength(6);
    expect(l.placements.every((p) => p.y === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Implement**

`src/math/layout.ts`:
```ts
import type { MathNode } from "./parser";
import { getGlyph } from "../glyphs/library";

export interface GlyphPlacement { char: string; x: number; y: number; scale: number }
export interface LineSeg { x1: number; y1: number; x2: number; y2: number }
export interface MathLayout {
  placements: GlyphPlacement[];
  lines: LineSeg[];
  width: number;
  ascent: number;
  descent: number;
}

const AXIS = -0.26;          // math axis (fraction bar height), em × scale
const SCRIPT_SCALE = 0.6;
const SUP_SHIFT = -0.42;
const SUB_SHIFT = 0.18;
const FRAC_GAP = 0.1;
const OP_PAD = 0.12;
const ROW_ASCENT = 0.8;
const ROW_DESCENT = 0.25;
const BINARY_OPS = new Set(["+", "-", "−", "=", "×", "÷", "±", "→", "≠", "≤", "≥", "≈", "<", ">", "⇌"]);
const DEFAULT_ADVANCE = 0.6;

function advanceOf(char: string): number {
  return getGlyph(char)?.advance ?? DEFAULT_ADVANCE;
}

function translate(l: MathLayout, dx: number, dy: number): MathLayout {
  return {
    placements: l.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    lines: l.lines.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy })),
    width: l.width,
    ascent: l.ascent - dy, // shifting down (dy>0) reduces ascent relative to new baseline caller frame
    descent: l.descent + dy,
  };
}

function layoutNode(node: MathNode, scale: number): MathLayout {
  switch (node.type) {
    case "sym": {
      const pad = BINARY_OPS.has(node.char) ? OP_PAD * scale : 0;
      return {
        placements: [{ char: node.char, x: pad, y: 0, scale }],
        lines: [],
        width: advanceOf(node.char) * scale + 2 * pad,
        ascent: ROW_ASCENT * scale,
        descent: ROW_DESCENT * scale,
      };
    }
    case "row": {
      const out: MathLayout = { placements: [], lines: [], width: 0, ascent: 0, descent: 0 };
      for (const child of node.children) {
        const c = layoutNode(child, scale);
        const shifted = translate(c, out.width, 0);
        out.placements.push(...shifted.placements);
        out.lines.push(...shifted.lines);
        out.width += c.width;
        out.ascent = Math.max(out.ascent, c.ascent);
        out.descent = Math.max(out.descent, c.descent);
      }
      if (node.children.length === 0) {
        out.ascent = ROW_ASCENT * scale;
        out.descent = ROW_DESCENT * scale;
      }
      return out;
    }
    case "frac": {
      const num = layoutNode(node.num, scale);
      const den = layoutNode(node.den, scale);
      const axis = AXIS * scale;
      const gap = FRAC_GAP * scale;
      const width = Math.max(num.width, den.width) + 0.2 * scale;
      const numDy = axis - gap - num.descent;   // numerator baseline
      const denDy = axis + gap + den.ascent;    // denominator baseline
      const numL = translate(num, (width - num.width) / 2, numDy);
      const denL = translate(den, (width - den.width) / 2, denDy);
      return {
        placements: [...numL.placements, ...denL.placements],
        lines: [
          ...numL.lines, ...denL.lines,
          { x1: 0.05 * scale, y1: axis, x2: width - 0.05 * scale, y2: axis },
        ],
        width,
        ascent: -(numDy) + num.ascent,
        descent: denDy + den.descent,
      };
    }
    case "sup": {
      const base = layoutNode(node.base, scale);
      const exp = layoutNode(node.exp, scale * SCRIPT_SCALE);
      const shift = SUP_SHIFT * scale;
      const expL = translate(exp, base.width, shift);
      return {
        placements: [...base.placements, ...expL.placements],
        lines: [...base.lines, ...expL.lines],
        width: base.width + exp.width,
        ascent: Math.max(base.ascent, -shift + exp.ascent),
        descent: base.descent,
      };
    }
    case "sub": {
      const base = layoutNode(node.base, scale);
      const sub = layoutNode(node.sub, scale * SCRIPT_SCALE);
      const shift = SUB_SHIFT * scale;
      const subL = translate(sub, base.width, shift);
      return {
        placements: [...base.placements, ...subL.placements],
        lines: [...base.lines, ...subL.lines],
        width: base.width + sub.width,
        ascent: base.ascent,
        descent: Math.max(base.descent, shift + sub.descent),
      };
    }
    case "sqrt": {
      const body = layoutNode(node.body, scale);
      const radicalScale = Math.max(scale, (body.ascent + body.descent) / (ROW_ASCENT + ROW_DESCENT));
      const radicalAdvance = advanceOf("√") * radicalScale;
      const bodyL = translate(body, radicalAdvance, 0);
      const barY = -(body.ascent + 0.08 * scale);
      return {
        placements: [
          { char: "√", x: 0, y: 0, scale: radicalScale },
          ...bodyL.placements,
        ],
        lines: [
          ...bodyL.lines,
          { x1: radicalAdvance - 0.08 * scale, y1: barY, x2: radicalAdvance + body.width, y2: barY },
        ],
        width: radicalAdvance + body.width + 0.05 * scale,
        ascent: -barY + 0.05 * scale,
        descent: body.descent,
      };
    }
  }
}

export function layoutMath(node: MathNode, scale = 1): MathLayout {
  return layoutNode(node, scale);
}

export function layoutText(text: string, scale = 1): MathLayout {
  return layoutNode(
    { type: "row", children: [...text].map((char) => ({ type: "sym" as const, char })) },
    scale
  );
}
```

Add to `src/index.ts`:
```ts
export { layoutMath, layoutText } from "./math/layout";
export type { MathLayout, GlyphPlacement, LineSeg } from "./math/layout";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS. If the "sup ascent" or frac assertions fail by small margins, adjust test tolerances only if the geometry is visually right — constants are the tuning knobs, tests assert *relative* relations.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: math layout engine (rows, fractions, scripts, radicals)"
```

---

### Task 8: Layout → strokes realization

**Files:**
- Create: `packages/stroke-engine/src/realize.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/realize.test.ts`

**Interfaces:**
- Consumes: `MathLayout` (Task 7), `getGlyph`/`FALLBACK_GLYPH` (Tasks 3-4), `Point`, `Stroke`
- Produces: `function realizeLayout(layout: MathLayout, origin: Point, fontSizePx: number): Stroke[]` — glyph strokes + layout lines converted to canvas-pixel strokes, in writing order (left to right by placement order, lines after the glyphs they belong to — layout emits them in order already).

- [ ] **Step 1: Write failing tests**

`src/realize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { realizeLayout } from "./realize";
import { layoutMath } from "./math/layout";
import { parseMath } from "./parser-helper-for-tests";
```

Note: no helper file — import directly:

```ts
import { describe, it, expect } from "vitest";
import { realizeLayout } from "./realize";
import { layoutMath } from "./math/layout";
import { parseMath } from "./math/parser";
import { getGlyph } from "./glyphs/library";

describe("realizeLayout", () => {
  it("emits one stroke set per glyph plus layout lines", () => {
    const layout = layoutMath(parseMath("\\frac{1}{2}"));
    const strokes = realizeLayout(layout, { x: 0, y: 0 }, 40);
    const expected =
      getGlyph("1")!.strokes.length + getGlyph("2")!.strokes.length + 1; // + bar
    expect(strokes).toHaveLength(expected);
  });
  it("scales and translates into pixel space", () => {
    const layout = layoutMath(parseMath("1"));
    const at100 = realizeLayout(layout, { x: 100, y: 200 }, 40);
    const flat = at100.flat();
    // baseline y=0 em maps to origin.y; glyph body is above => y < 200
    expect(Math.max(...flat.map((p) => p.y))).toBeLessThanOrEqual(200 + 1);
    expect(Math.min(...flat.map((p) => p.x))).toBeGreaterThanOrEqual(100 - 1);
  });
  it("uses fallback glyph for unknown chars", () => {
    const layout = layoutMath(parseMath("☃"));
    const strokes = realizeLayout(layout, { x: 0, y: 0 }, 40);
    expect(strokes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./realize`.

- [ ] **Step 3: Implement**

`src/realize.ts`:
```ts
import type { Point, Stroke } from "./types";
import type { MathLayout } from "./math/layout";
import { getGlyph, FALLBACK_GLYPH } from "./glyphs/library";

/** Convert an em-space layout into canvas-pixel strokes, in writing order. */
export function realizeLayout(layout: MathLayout, origin: Point, fontSizePx: number): Stroke[] {
  const out: Stroke[] = [];
  for (const p of layout.placements) {
    const glyph = getGlyph(p.char) ?? FALLBACK_GLYPH;
    for (const s of glyph.strokes) {
      out.push(
        s.map((pt) => ({
          x: origin.x + (p.x + pt.x * p.scale) * fontSizePx,
          y: origin.y + (p.y + pt.y * p.scale) * fontSizePx,
        }))
      );
    }
  }
  for (const l of layout.lines) {
    out.push([
      { x: origin.x + l.x1 * fontSizePx, y: origin.y + l.y1 * fontSizePx },
      { x: origin.x + l.x2 * fontSizePx, y: origin.y + l.y2 * fontSizePx },
    ]);
  }
  return out;
}
```

Add to `src/index.ts`:
```ts
export { realizeLayout } from "./realize";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: realize layouts into pixel-space strokes"
```

---

### Task 9: Diagram primitives

**Files:**
- Create: `packages/stroke-engine/src/diagrams.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/diagrams.test.ts`

**Interfaces:**
- Consumes: `Point`, `Stroke`
- Produces:
  ```ts
  type Diagram =
    | { kind: "axes"; width: number; height: number }                    // px
    | { kind: "curve"; fn: (x: number) => number; domain: [number, number];
        width: number; height: number; yRange: [number, number] }
    | { kind: "arrow"; from: Point; to: Point }
    | { kind: "benzene"; center: Point; radius: number };
  function diagramStrokes(d: Diagram, origin: Point): Stroke[]
  ```
  Axes origin convention: `origin` = bottom-left of the plot box; x-axis along the bottom, y-axis up the left side. Curve is plotted inside the same box (`fn` in math coords, y up, mapped into the box).

- [ ] **Step 1: Write failing tests**

`src/diagrams.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { diagramStrokes } from "./diagrams";

describe("diagramStrokes", () => {
  it("axes: two arrowed axes = 6 strokes (2 lines + 2 heads of 2 strokes)", () => {
    const s = diagramStrokes({ kind: "axes", width: 300, height: 200 }, { x: 50, y: 250 });
    expect(s).toHaveLength(6);
  });
  it("curve: single smooth stroke with dense samples inside the box", () => {
    const s = diagramStrokes(
      {
        kind: "curve", fn: (x) => x * x, domain: [-2, 2],
        width: 300, height: 200, yRange: [0, 4],
      },
      { x: 50, y: 250 }
    );
    expect(s).toHaveLength(1);
    expect(s[0].length).toBeGreaterThanOrEqual(30);
    for (const p of s[0]) {
      expect(p.x).toBeGreaterThanOrEqual(50 - 1);
      expect(p.x).toBeLessThanOrEqual(350 + 1);
      expect(p.y).toBeLessThanOrEqual(250 + 1);
      expect(p.y).toBeGreaterThanOrEqual(50 - 1);
    }
    // parabola vertex (x=0 -> y=0) maps to bottom of box
    const mid = s[0][Math.floor(s[0].length / 2)];
    expect(mid.y).toBeGreaterThan(200);
  });
  it("arrow: shaft + head = 2 strokes", () => {
    const s = diagramStrokes({ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, { x: 0, y: 0 });
    expect(s).toHaveLength(2);
    expect(s[0][0]).toEqual({ x: 0, y: 0 });
    expect(s[0][1]).toEqual({ x: 100, y: 0 });
  });
  it("benzene: hexagon + inner circle = 2 strokes", () => {
    const s = diagramStrokes({ kind: "benzene", center: { x: 100, y: 100 }, radius: 50 }, { x: 0, y: 0 });
    expect(s).toHaveLength(2);
    expect(s[0]).toHaveLength(7); // closed hexagon
    // circle points within radius
    for (const p of s[1]) {
      const r = Math.hypot(p.x - 100, p.y - 100);
      expect(r).toBeLessThan(50);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./diagrams`.

- [ ] **Step 3: Implement**

`src/diagrams.ts`:
```ts
import type { Point, Stroke } from "./types";

export type Diagram =
  | { kind: "axes"; width: number; height: number }
  | { kind: "curve"; fn: (x: number) => number; domain: [number, number];
      width: number; height: number; yRange: [number, number] }
  | { kind: "arrow"; from: Point; to: Point }
  | { kind: "benzene"; center: Point; radius: number };

const HEAD_LEN = 12;
const HEAD_ANGLE = Math.PI / 7;

function arrowHead(from: Point, to: Point): Stroke[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (side: number): Stroke => [
    {
      x: to.x - HEAD_LEN * Math.cos(angle + side * HEAD_ANGLE),
      y: to.y - HEAD_LEN * Math.sin(angle + side * HEAD_ANGLE),
    },
    { x: to.x, y: to.y },
  ];
  return [wing(1), wing(-1)];
}

export function diagramStrokes(d: Diagram, origin: Point): Stroke[] {
  switch (d.kind) {
    case "axes": {
      const xEnd = { x: origin.x + d.width, y: origin.y };
      const yEnd = { x: origin.x, y: origin.y - d.height };
      return [
        [{ x: origin.x, y: origin.y }, xEnd],
        ...arrowHead(origin, xEnd),
        [{ x: origin.x, y: origin.y }, yEnd],
        ...arrowHead(origin, yEnd),
      ];
    }
    case "curve": {
      const [x0, x1] = d.domain;
      const [y0, y1] = d.yRange;
      const n = 48;
      const pts: Stroke = [];
      for (let i = 0; i <= n; i++) {
        const mx = x0 + ((x1 - x0) * i) / n;
        const my = Math.min(y1, Math.max(y0, d.fn(mx)));
        pts.push({
          x: origin.x + ((mx - x0) / (x1 - x0)) * d.width,
          y: origin.y - ((my - y0) / (y1 - y0)) * d.height,
        });
      }
      return [pts];
    }
    case "arrow": {
      const from = { x: origin.x + d.from.x, y: origin.y + d.from.y };
      const to = { x: origin.x + d.to.x, y: origin.y + d.to.y };
      // shaft, then a single bent head stroke (wing-tip -> tip -> wing-tip)
      const [w1, w2] = arrowHead(from, to);
      return [[from, to], [w1[0], w1[1], w2[0]]];
    }
    case "benzene": {
      const c = { x: origin.x + d.center.x, y: origin.y + d.center.y };
      const hex: Stroke = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        hex.push({ x: c.x + d.radius * Math.cos(a), y: c.y + d.radius * Math.sin(a) });
      }
      const circle: Stroke = [];
      const r = d.radius * 0.6;
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        circle.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      }
      return [hex, circle];
    }
  }
}
```

Add to `src/index.ts`:
```ts
export { diagramStrokes } from "./diagrams";
export type { Diagram } from "./diagrams";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: diagram primitives (axes, curve, arrow, benzene)"
```

---

### Task 10: Planner — ops → timed RenderPlan

**Files:**
- Create: `packages/stroke-engine/src/planner.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/planner.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  ```ts
  type Op =
    | { type: "write_math"; tex: string; at: Point; size: number }
    | { type: "write_text"; text: string; at: Point; size: number }
    | { type: "draw_diagram"; diagram: Diagram; at: Point };
  interface PenStroke { points: Stroke; durationMs: number }
  interface RenderPlan { strokes: PenStroke[]; totalMs: number }
  function buildPlan(ops: Op[], opts?: { seed?: number; jitterAmount?: number }): RenderPlan
  ```
  Timing: pen speed 0.45 px/ms, per-stroke duration clamped to [60, 2000] ms, inter-stroke gap 60 ms (included in `totalMs` accounting: `totalMs = Σ duration + gap × (n−1)`). Jitter amount default: `0.015 × size` px for glyph ops, `2` px for diagrams.

- [ ] **Step 1: Write failing tests**

`src/planner.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildPlan } from "./planner";
import type { Op } from "./planner";

const mathOp: Op = { type: "write_math", tex: "2x+3=7", at: { x: 50, y: 100 }, size: 40 };

describe("buildPlan", () => {
  it("produces strokes with positive durations", () => {
    const plan = buildPlan([mathOp], { seed: 42 });
    expect(plan.strokes.length).toBeGreaterThan(5);
    for (const s of plan.strokes) {
      expect(s.durationMs).toBeGreaterThanOrEqual(60);
      expect(s.durationMs).toBeLessThanOrEqual(2000);
      expect(s.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(plan.totalMs).toBeGreaterThan(0);
  });
  it("is deterministic for the same seed", () => {
    const a = buildPlan([mathOp], { seed: 42 });
    const b = buildPlan([mathOp], { seed: 42 });
    expect(a).toEqual(b);
  });
  it("differs across seeds (jitter)", () => {
    const a = buildPlan([mathOp], { seed: 1 });
    const b = buildPlan([mathOp], { seed: 2 });
    expect(a).not.toEqual(b);
  });
  it("handles text and diagram ops", () => {
    const plan = buildPlan(
      [
        { type: "write_text", text: "Solve:", at: { x: 10, y: 40 }, size: 30 },
        { type: "draw_diagram", diagram: { kind: "axes", width: 200, height: 150 }, at: { x: 10, y: 300 } },
      ],
      { seed: 42 }
    );
    expect(plan.strokes.length).toBeGreaterThan(6);
  });
  it("throws MathParseError for bad TeX (caller handles per spec §6)", () => {
    expect(() =>
      buildPlan([{ type: "write_math", tex: "\\bogus", at: { x: 0, y: 0 }, size: 40 }])
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./planner`.

- [ ] **Step 3: Implement**

`src/planner.ts`:
```ts
import type { Point, Stroke } from "./types";
import { strokeLength } from "./types";
import { mulberry32 } from "./rng";
import { jitterStroke } from "./jitter";
import { parseMath } from "./math/parser";
import { layoutMath, layoutText } from "./math/layout";
import { realizeLayout } from "./realize";
import { diagramStrokes, type Diagram } from "./diagrams";

export type Op =
  | { type: "write_math"; tex: string; at: Point; size: number }
  | { type: "write_text"; text: string; at: Point; size: number }
  | { type: "draw_diagram"; diagram: Diagram; at: Point };

export interface PenStroke { points: Stroke; durationMs: number }
export interface RenderPlan { strokes: PenStroke[]; totalMs: number }

const PEN_SPEED_PX_PER_MS = 0.45;
const MIN_STROKE_MS = 60;
const MAX_STROKE_MS = 2000;
export const STROKE_GAP_MS = 60;

function opStrokes(op: Op): { strokes: Stroke[]; jitterPx: number; jitterStep: number } {
  switch (op.type) {
    case "write_math": {
      const layout = layoutMath(parseMath(op.tex));
      return {
        strokes: realizeLayout(layout, op.at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "write_text": {
      const layout = layoutText(op.text);
      return {
        strokes: realizeLayout(layout, op.at, op.size),
        jitterPx: 0.015 * op.size,
        jitterStep: 0.08 * op.size,
      };
    }
    case "draw_diagram":
      return { strokes: diagramStrokes(op.diagram, op.at), jitterPx: 2, jitterStep: 8 };
  }
}

export function buildPlan(
  ops: Op[],
  opts: { seed?: number; jitterAmount?: number } = {}
): RenderPlan {
  const rng = mulberry32(opts.seed ?? 1);
  const strokes: PenStroke[] = [];
  for (const op of ops) {
    const { strokes: raw, jitterPx, jitterStep } = opStrokes(op);
    const amount = opts.jitterAmount ?? jitterPx;
    for (const s of raw) {
      const jittered = jitterStroke(s, rng, amount, jitterStep);
      const durationMs = Math.min(
        MAX_STROKE_MS,
        Math.max(MIN_STROKE_MS, strokeLength(jittered) / PEN_SPEED_PX_PER_MS)
      );
      strokes.push({ points: jittered, durationMs });
    }
  }
  const totalMs =
    strokes.reduce((acc, s) => acc + s.durationMs, 0) +
    Math.max(0, strokes.length - 1) * STROKE_GAP_MS;
  return { strokes, totalMs };
}
```

Add to `src/index.ts`:
```ts
export { buildPlan, STROKE_GAP_MS } from "./planner";
export type { Op, PenStroke, RenderPlan } from "./planner";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: planner builds timed jittered render plans from ops"
```

---

### Task 11: Frame renderer + canvas player

**Files:**
- Create: `packages/stroke-engine/src/render.ts`
- Modify: `packages/stroke-engine/src/index.ts`
- Test: `packages/stroke-engine/src/render.test.ts`

**Interfaces:**
- Consumes: `RenderPlan`, `PenStroke`, `STROKE_GAP_MS`
- Produces:
  ```ts
  // Minimal 2D-context surface the engine touches (subset of CanvasRenderingContext2D)
  interface StrokeCtx {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
  }
  function renderFrame(plan: RenderPlan, elapsedMs: number, ctx: StrokeCtx): boolean // true = done
  class Player {
    constructor(ctx: StrokeCtx, opts?: { clear?: () => void });
    play(plan: RenderPlan): void;
    pause(): void; resume(): void; replay(): void; stop(): void;
  }
  ```
  `renderFrame` is pure w.r.t. the plan/time (draws everything visible at `elapsedMs`; caller clears first). `Player` is a thin rAF wrapper — tested only via `renderFrame`.

- [ ] **Step 1: Write failing tests**

`src/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderFrame } from "./render";
import type { RenderPlan } from "./planner";

function stubCtx() {
  const calls: string[] = [];
  return {
    calls,
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    stroke: () => calls.push("stroke"),
  };
}

const plan: RenderPlan = {
  strokes: [
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], durationMs: 100 },
    { points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], durationMs: 100 },
  ],
  totalMs: 260, // 100 + 60 gap + 100
};

describe("renderFrame", () => {
  it("draws nothing at t=0 except pen start", () => {
    const ctx = stubCtx();
    renderFrame(plan, 0, ctx);
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBe(0);
  });
  it("draws partial first stroke midway", () => {
    const ctx = stubCtx();
    const done = renderFrame(plan, 50, ctx);
    expect(done).toBe(false);
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBeGreaterThan(0);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });
  it("during the gap only the first stroke is drawn", () => {
    const ctx = stubCtx();
    renderFrame(plan, 130, ctx); // inside 100..160 gap
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });
  it("draws everything and reports done at totalMs", () => {
    const ctx = stubCtx();
    const done = renderFrame(plan, 260, ctx);
    expect(done).toBe(true);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @teacher/stroke-engine`
Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 3: Implement**

`src/render.ts`:
```ts
import type { RenderPlan, PenStroke } from "./planner";
import { STROKE_GAP_MS } from "./planner";
import { strokeLength } from "./types";

export interface StrokeCtx {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

function drawFull(s: PenStroke, ctx: StrokeCtx): void {
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
  ctx.stroke();
}

function drawPartial(s: PenStroke, fraction: number, ctx: StrokeCtx): void {
  const target = strokeLength(s.points) * fraction;
  if (target <= 0) return;
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  let acc = 0;
  let drew = false;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg <= target) {
      ctx.lineTo(b.x, b.y);
      drew = true;
      acc += seg;
    } else {
      const t = (target - acc) / seg;
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      drew = true;
      break;
    }
  }
  if (drew) ctx.stroke();
}

/** Draw the state of the plan at `elapsedMs`. Returns true when complete. */
export function renderFrame(plan: RenderPlan, elapsedMs: number, ctx: StrokeCtx): boolean {
  let t = elapsedMs;
  for (let i = 0; i < plan.strokes.length; i++) {
    const s = plan.strokes[i];
    if (t >= s.durationMs) {
      drawFull(s, ctx);
      t -= s.durationMs;
      if (i < plan.strokes.length - 1) {
        if (t < STROKE_GAP_MS) return false; // in the gap; later strokes not started
        t -= STROKE_GAP_MS;
      }
    } else {
      drawPartial(s, t / s.durationMs, ctx);
      return false;
    }
  }
  return true;
}

/** Thin requestAnimationFrame wrapper around renderFrame. Not unit-tested. */
export class Player {
  private plan: RenderPlan | null = null;
  private startTime = 0;
  private pausedAt: number | null = null;
  private raf = 0;

  constructor(
    private ctx: StrokeCtx,
    private opts: { clear?: () => void } = {}
  ) {}

  play(plan: RenderPlan): void {
    this.stop();
    this.plan = plan;
    this.startTime = performance.now();
    this.tick();
  }

  pause(): void {
    if (this.pausedAt === null && this.plan) {
      this.pausedAt = performance.now();
      cancelAnimationFrame(this.raf);
    }
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.startTime += performance.now() - this.pausedAt;
      this.pausedAt = null;
      this.tick();
    }
  }

  replay(): void {
    if (this.plan) this.play(this.plan);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.pausedAt = null;
  }

  private tick = (): void => {
    if (!this.plan) return;
    this.opts.clear?.();
    const done = renderFrame(this.plan, performance.now() - this.startTime, this.ctx);
    if (!done && this.pausedAt === null) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };
}
```

Add to `src/index.ts`:
```ts
export { renderFrame, Player } from "./render";
export type { StrokeCtx } from "./render";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stroke-engine/src
git commit -m "feat: frame renderer and rAF canvas player"
```

---

### Task 12: Golden snapshot regression suite

**Files:**
- Test: `packages/stroke-engine/src/golden.test.ts`

**Interfaces:**
- Consumes: `buildPlan` (Task 10)
- Produces: Vitest snapshot file pinning stroke geometry for a fixed seed — the deterministic stand-in for PNG visual diffs (Global Constraints).

- [ ] **Step 1: Write the snapshot test**

`src/golden.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildPlan } from "./planner";
import type { Op } from "./planner";

const GOLDEN: { name: string; ops: Op[] }[] = [
  { name: "linear-equation", ops: [{ type: "write_math", tex: "2x+3=7", at: { x: 40, y: 80 }, size: 42 }] },
  { name: "quadratic-formula", ops: [{ type: "write_math", tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", at: { x: 40, y: 120 }, size: 42 }] },
  { name: "physics-kinematics", ops: [{ type: "write_math", tex: "v=v_0+at", at: { x: 40, y: 80 }, size: 42 }] },
  { name: "greek-and-symbols", ops: [{ type: "write_math", tex: "\\Delta\\theta\\approx\\pi\\div2", at: { x: 40, y: 80 }, size: 42 }] },
  {
    name: "parabola-plot",
    ops: [
      { type: "draw_diagram", diagram: { kind: "axes", width: 260, height: 180 }, at: { x: 40, y: 260 } },
      {
        type: "draw_diagram",
        diagram: { kind: "curve", fn: (x) => x * x, domain: [-2, 2], width: 260, height: 180, yRange: [0, 4] },
        at: { x: 40, y: 260 },
      },
      { type: "write_math", tex: "y=x^2", at: { x: 220, y: 110 }, size: 30 },
    ],
  },
  {
    name: "benzene",
    ops: [{ type: "draw_diagram", diagram: { kind: "benzene", center: { x: 120, y: 120 }, radius: 60 }, at: { x: 0, y: 0 } }],
  },
];

function summarize(ops: Op[]) {
  const plan = buildPlan(ops, { seed: 42 });
  return {
    strokeCount: plan.strokes.length,
    totalMs: Math.round(plan.totalMs),
    strokes: plan.strokes.map((s) => ({
      durationMs: Math.round(s.durationMs),
      points: s.points.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
    })),
  };
}

describe("golden renders (seed 42)", () => {
  it.each(GOLDEN)("$name", ({ ops }) => {
    expect(summarize(ops)).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to create snapshots**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS, 6 snapshots written to `src/__snapshots__/golden.test.ts.snap`.

- [ ] **Step 3: Run again to verify stability**

Run: `npm test -w @teacher/stroke-engine`
Expected: all PASS, 0 snapshots written (deterministic).

- [ ] **Step 4: Commit (including the snapshot file)**

```bash
git add packages/stroke-engine/src
git commit -m "test: golden stroke snapshots for regression"
```

---

### Task 13: Demo web app

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `buildPlan`, `Player`, `Op`, `Diagram` from `@teacher/stroke-engine`
- Produces: `npm run dev -w @teacher/web` → demo page: chalkboard canvas, TeX input, preset buttons, replay/clear.

- [ ] **Step 1: Create app scaffold files**

`apps/web/package.json`:
```json
{
  "name": "@teacher/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "@teacher/stroke-engine": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Teacher — Stroke Engine Demo</title>
  </head>
  <body style="margin:0">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // resolve workspace package straight to TS source
      "@teacher/stroke-engine": path.resolve(
        __dirname,
        "../../packages/stroke-engine/src/index.ts"
      ),
    },
  },
});
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 2: Implement the demo App**

`apps/web/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { buildPlan, Player, MathParseError } from "@teacher/stroke-engine";
import type { Op, RenderPlan } from "@teacher/stroke-engine";

const CHALK = "#f5f0dc";
const BOARD = "#1e3a2f";
const W = 900;
const H = 520;

const PRESETS: { label: string; ops: Op[] }[] = [
  {
    label: "Solve 2x+3=7",
    ops: [
      { type: "write_text", text: "Solve:", at: { x: 40, y: 70 }, size: 34 },
      { type: "write_math", tex: "2x+3=7", at: { x: 180, y: 70 }, size: 42 },
      { type: "write_math", tex: "2x=4", at: { x: 180, y: 150 }, size: 42 },
      { type: "write_math", tex: "x=2", at: { x: 180, y: 230 }, size: 42 },
    ],
  },
  {
    label: "Quadratic formula",
    ops: [{ type: "write_math", tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", at: { x: 60, y: 160 }, size: 48 }],
  },
  {
    label: "Parabola",
    ops: [
      { type: "draw_diagram", diagram: { kind: "axes", width: 320, height: 240 }, at: { x: 80, y: 340 } },
      {
        type: "draw_diagram",
        diagram: { kind: "curve", fn: (x) => x * x, domain: [-2, 2], width: 320, height: 240, yRange: [0, 4] },
        at: { x: 80, y: 340 },
      },
      { type: "write_math", tex: "y=x^2", at: { x: 300, y: 140 }, size: 34 },
    ],
  },
  {
    label: "Benzene",
    ops: [
      { type: "draw_diagram", diagram: { kind: "benzene", center: { x: 200, y: 200 }, radius: 80 }, at: { x: 60, y: 60 } },
      { type: "write_math", tex: "C_6H_6", at: { x: 420, y: 260 }, size: 40 },
    ],
  },
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const lastPlanRef = useRef<RenderPlan | null>(null);
  const [tex, setTex] = useState("\\frac{x+1}{x-2}");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = CHALK;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    playerRef.current = new Player(ctx, {
      clear: () => {
        ctx.clearRect(0, 0, W, H);
      },
    });
    return () => playerRef.current?.stop();
  }, []);

  function play(ops: Op[]) {
    setError(null);
    setPaused(false);
    try {
      const plan = buildPlan(ops, { seed: Math.floor(Math.random() * 1e9) });
      lastPlanRef.current = plan;
      playerRef.current?.play(plan);
    } catch (e) {
      setError(e instanceof MathParseError ? e.message : String(e));
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", background: "#11150f", minHeight: "100vh", padding: 24, color: "#ddd" }}>
      <h1 style={{ fontSize: 20 }}>Stroke Engine Demo</h1>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ background: BOARD, borderRadius: 8, border: "8px solid #6b4f2a", maxWidth: "100%" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={tex}
          onChange={(e) => setTex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") play([{ type: "write_math", tex, at: { x: 60, y: 140 }, size: 46 }]);
          }}
          style={{ width: 360, padding: 8, fontFamily: "monospace" }}
          placeholder="TeX subset, e.g. \frac{1}{2}"
        />
        <button onClick={() => play([{ type: "write_math", tex, at: { x: 60, y: 140 }, size: 46 }])}>Write</button>
        <button
          onClick={() => {
            if (paused) playerRef.current?.resume();
            else playerRef.current?.pause();
            setPaused(!paused);
          }}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={() => playerRef.current?.replay()}>Replay</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => play(p.ops)}>{p.label}</button>
        ))}
      </div>
      {error && <p style={{ color: "#ff8080" }}>Parse error: {error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Install and run**

Run (repo root): `npm install` then `npm run dev -w @teacher/web`
Expected: Vite dev server URL printed.

- [ ] **Step 4: Manual verification checklist**

Open the dev URL and verify:
- "Solve 2x+3=7" preset: text + three equation lines animate stroke-by-stroke, look handwritten (wobbly, not font-perfect)
- "Quadratic formula": fraction stacked correctly, √ covers `b^2-4ac`, ± and superscript render
- "Parabola": axes with arrowheads, smooth curve, `y=x^2` label
- "Benzene": hexagon + inner circle, `C_6H_6` subscripts
- Typing `\frac{\pi}{\theta}` + Enter renders; typing `\bogus` shows a parse error, no crash
- Pause freezes mid-stroke-gap; Resume continues; Replay redraws with the same jitter
- Writing again uses different jitter (random seed per play)

- [ ] **Step 5: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat: stroke engine demo web app"
```

---

## Self-Review Notes

- **Spec coverage (P1 scope, spec §4.1 + §8):** glyph library ✅ (T3+T4), jitter ✅ (T5), math layout w/ TeX subset ✅ (T6-T8), diagram primitives ✅ (T9; circuit parts + Lewis dots deferred to later phases per spec §9), planner/timing ✅ (T10), animated canvas rendering ✅ (T11), demo page ✅ (T13), regression snapshots ✅ (T12). "Strokes in, animation out" ML swap boundary preserved via `registerGlyph` + `RenderPlan`.
- **Types cross-checked:** `Stroke = Point[]`, `GlyphDef`, `MathLayout`, `Op`, `PenStroke`, `RenderPlan`, `StrokeCtx` used consistently across tasks.
- **Known risk:** `hersheytext` data shape (T3 step 2 includes the inspection fallback). Layout constants are tuning knobs; tests assert relative geometry, not exact values.
