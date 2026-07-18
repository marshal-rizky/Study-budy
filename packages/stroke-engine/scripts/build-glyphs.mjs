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

// Hershey paths use absolute M/L only, but rely on SVG implicit repetition:
// "M4,6 L4,5 5,3 6,2 8,1" is one moveto plus FOUR linetos. Every coordinate
// pair after a command letter must be consumed, or curves collapse to their
// first segment.
function parseStrokes(d) {
  const strokes = [];
  let current = null;
  for (const chunk of d.match(/[ML][^ML]*/g) ?? []) {
    const cmd = chunk[0];
    const nums = (chunk.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const pt = [nums[i], nums[i + 1]];
      if (cmd === "M" && i === 0) {
        current = [pt];
        strokes.push(current);
      } else if (current) {
        current.push(pt); // implicit lineto
      }
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
