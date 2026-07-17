import { useEffect, useRef, useState } from "react";
import { buildPlan, Player, MathParseError } from "@teacher/stroke-engine";
import type { Op } from "@teacher/stroke-engine";

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
    try {
      const plan = buildPlan(ops, { seed: Math.floor(Math.random() * 1e9) });
      playerRef.current?.play(plan);
      setPaused(false);
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
        <button onClick={() => { playerRef.current?.replay(); setPaused(false); }}>Replay</button>
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
