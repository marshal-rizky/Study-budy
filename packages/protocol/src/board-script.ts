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

const MathStepSchema = z.object({
  kind: z.literal("math"),
  tex: z.string().min(1),
  narration: z.string().min(1),
});

const TextStepSchema = z.object({
  kind: z.literal("text"),
  text: z.string().min(1),
  narration: z.string().min(1),
});

const DiagramStepSchema = z.object({
  kind: z.literal("diagram"),
  diagram: DiagramSpecSchema,
  narration: z.string().min(1),
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
