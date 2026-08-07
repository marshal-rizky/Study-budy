import { z } from "zod";

// Declarative, JSON-safe diagram spec. Mirrors the engine's Diagram union but
// carries `expr` as a STRING for curves -- never a function, because this
// crosses the wire from a model.

const finitePositive = z.number().finite().positive();

const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const AxesDiagramSchema = z.object({
  kind: z.literal("axes"),
  width: finitePositive,
  height: finitePositive,
});

const CurveDiagramSchema = z.object({
  kind: z.literal("curve"),
  expr: z.string().min(1),
  domain: z.tuple([z.number().finite(), z.number().finite()]),
  width: finitePositive,
  height: finitePositive,
  yRange: z.tuple([z.number().finite(), z.number().finite()]),
});

const ArrowDiagramSchema = z.object({
  kind: z.literal("arrow"),
  from: PointSchema,
  to: PointSchema,
});

const BenzeneDiagramSchema = z.object({
  kind: z.literal("benzene"),
  radius: finitePositive,
});

export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  AxesDiagramSchema,
  CurveDiagramSchema,
  ArrowDiagramSchema,
  BenzeneDiagramSchema,
]);

export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

// Accepted steps are replayed verbatim into every later turn's message
// history, so one oversized field inflates token spend for the rest of the
// run before `maxTotalTokens` can trip. These caps are generous for any real
// step a teacher would write on a board -- `text` in particular is meant to
// be a short label or phrase (see tools.ts's WRITE_TEXT_DESCRIPTION) -- and
// far below the range that meaningfully inflates spend.
const MAX_TEX_LENGTH = 1000;
const MAX_TEXT_LENGTH = 1000;
const MAX_NARRATION_LENGTH = 2000;

const MathStepSchema = z.object({
  kind: z.literal("math"),
  tex: z.string().min(1).max(MAX_TEX_LENGTH),
  narration: z.string().min(1).max(MAX_NARRATION_LENGTH),
});

const TextStepSchema = z.object({
  kind: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  narration: z.string().min(1).max(MAX_NARRATION_LENGTH),
});

const DiagramStepSchema = z.object({
  kind: z.literal("diagram"),
  diagram: DiagramSpecSchema,
  narration: z.string().min(1).max(MAX_NARRATION_LENGTH),
});

const NewPageStepSchema = z.object({
  kind: z.literal("new_page"),
});

export const BoardStepSchema = z.discriminatedUnion("kind", [
  MathStepSchema,
  TextStepSchema,
  DiagramStepSchema,
  NewPageStepSchema,
]);

export type BoardStep = z.infer<typeof BoardStepSchema>;

export const BoardScriptSchema = z.object({
  scriptId: z.string().min(1),
  steps: z.array(BoardStepSchema),
});

export type BoardScript = z.infer<typeof BoardScriptSchema>;

export function parseBoardScript(input: unknown): BoardScript {
  const result = BoardScriptSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid BoardScript: ${issues}`);
  }
  return result.data;
}
