/**
 * The four tools exposed to the model, with JSON Schemas GENERATED from the
 * Task 1 zod schemas in `@teacher/protocol` (`zod-to-json-schema`) so the
 * tool surface and the protocol cannot drift apart. Nothing here
 * hand-duplicates a field list -- if `BoardStepSchema` changes, these
 * schemas change with it.
 *
 * The outer discriminant (`kind`) is stripped from each generated schema:
 * the tool *name* already conveys which step kind this is (`write_math` ->
 * "math"), so the model never needs to pass `kind` itself. `director.ts`
 * re-attaches the right `kind` before validating the reconstructed step
 * against `BoardStepSchema`.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BoardStepSchema } from "@teacher/protocol";
import type { ToolDef } from "./client";

type StepKind = "math" | "text" | "diagram" | "new_page";

function jsonSchemaFor(kind: StepKind): object {
  // BoardStepSchema.options is a union of four distinct ZodObject types (one per
  // discriminant), so TS can't give `.find` a single precise return type. Widen to a
  // generic ZodObject once we've picked the right member -- every option genuinely is
  // one, `kind` included, so `.omit` below is exactly as safe as it looks.
  const option = BoardStepSchema.options.find((o) => o.shape.kind.value === kind) as
    | z.ZodObject<z.ZodRawShape>
    | undefined;
  if (!option) {
    throw new Error(`board-director: no BoardStep schema found for kind "${kind}"`);
  }
  const withoutKind = option.omit({ kind: true });
  const schema = zodToJsonSchema(withoutKind, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}

const WRITE_MATH_DESCRIPTION = `Write one mathematical expression or equation as a step on the board.

TeX SUBSET SUPPORTED -- the rendering engine's parser is narrow and REJECTS anything outside it:
- \\frac{}{}, \\sqrt{}
- ^ (superscript) and _ (subscript)
- symbol commands: \\pi \\theta \\Delta \\int \\sum \\times \\div \\pm \\to \\ne \\le \\ge \\approx \\rightleftharpoons
- digits, letters, + - * / ( ) = and { } grouping

UNSUPPORTED -- do not use these, they will be REJECTED: \\left, \\right, \\cdot, \\text{}, escaped spaces
(\\ ), \\begin{}/\\end{} environments, matrices, or any command not listed above.

write_text does NOT parse TeX. Any mathematical content -- equations, formulas, single symbols -- must
go through write_math, never write_text.`;

const WRITE_TEXT_DESCRIPTION = `Write plain narrative or explanatory text as a step on the board (e.g.
"Now we factor the quadratic."). This is rendered literally as text -- it is NOT parsed as TeX or math
notation. Never put an equation, formula, or math symbol here; use write_math for anything mathematical.`;

const DRAW_DIAGRAM_DESCRIPTION = `Draw a diagram step: coordinate axes, a plotted curve, an arrow, or a
benzene ring. A curve's \`expr\` is a plain expression string in x (e.g. "x^2", "sin(x)*2") evaluated by a
small whitelisted grammar -- it is NOT TeX and NOT arbitrary code.`;

const NEW_PAGE_DESCRIPTION = `Start a fresh page on the board. Use when the current page is full or when
moving on to a clearly separate part of the solution.`;

export const TOOLS: ToolDef[] = [
  { name: "write_math", description: WRITE_MATH_DESCRIPTION, inputSchema: jsonSchemaFor("math") },
  { name: "write_text", description: WRITE_TEXT_DESCRIPTION, inputSchema: jsonSchemaFor("text") },
  {
    name: "draw_diagram",
    description: DRAW_DIAGRAM_DESCRIPTION,
    inputSchema: jsonSchemaFor("diagram"),
  },
  {
    name: "new_page",
    description: NEW_PAGE_DESCRIPTION,
    inputSchema: jsonSchemaFor("new_page"),
  },
];

/** Maps a tool name to the `BoardStep.kind` it produces. */
export const TOOL_TO_STEP_KIND: Record<string, StepKind> = {
  write_math: "math",
  write_text: "text",
  draw_diagram: "diagram",
  new_page: "new_page",
};
