import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BoardStepSchema } from "@teacher/protocol";
import { TOOLS, TOOL_TO_STEP_KIND } from "./tools";

describe("TOOLS", () => {
  it("exposes exactly the four board-writing tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      ["draw_diagram", "new_page", "write_math", "write_text"].sort()
    );
  });

  it("write_math's JSON schema requires both tex and narration, and is protocol-derived", () => {
    const mathTool = TOOLS.find((t) => t.name === "write_math");
    expect(mathTool).toBeDefined();

    const schema = mathTool!.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["tex", "narration"]));
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["narration", "tex"]);
    // `kind` is implied by the tool name, never something the model has to supply.
    expect(schema.properties).not.toHaveProperty("kind");

    // Prove this is GENERATED from @teacher/protocol's BoardStepSchema, not hand-copied:
    // independently derive the same schema here, straight from the protocol package, and
    // assert it's identical to what tools.ts produced.
    const mathOption = BoardStepSchema.options.find((o) => o.shape.kind.value === "math") as
      | z.ZodObject<z.ZodRawShape>
      | undefined;
    expect(mathOption).toBeDefined();
    const expected = zodToJsonSchema(mathOption!.omit({ kind: true }), {
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete expected.$schema;
    expect(mathTool!.inputSchema).toEqual(expected);
  });

  it("write_math's description states the supported TeX subset and flags common unsupported commands", () => {
    const mathTool = TOOLS.find((t) => t.name === "write_math")!;
    for (const supported of ["\\frac", "\\sqrt", "\\pi", "\\theta", "\\Delta"]) {
      expect(mathTool.description).toContain(supported);
    }
    for (const unsupported of ["\\left", "\\right", "\\cdot", "\\text{}"]) {
      expect(mathTool.description).toContain(unsupported);
    }
  });

  it("write_text's description states it does not parse TeX", () => {
    const textTool = TOOLS.find((t) => t.name === "write_text")!;
    expect(textTool.description.toLowerCase()).toContain("not");
    expect(textTool.description.toLowerCase()).toContain("tex");
  });

  it("draw_diagram's schema requires diagram and narration", () => {
    const diagramTool = TOOLS.find((t) => t.name === "draw_diagram")!;
    const schema = diagramTool.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["diagram", "narration"]));
  });

  it("draw_diagram's schema contains no node whose `items` is an array (Bug 1: draft 2020-12 rejects the draft-07 tuple form)", () => {
    const diagramTool = TOOLS.find((t) => t.name === "draw_diagram")!;

    function assertNoArrayItems(node: unknown, path: string): void {
      if (Array.isArray(node)) {
        node.forEach((child, i) => assertNoArrayItems(child, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if ("items" in obj) {
        expect(Array.isArray(obj.items), `${path}.items must not be an array`).toBe(false);
      }
      for (const [key, value] of Object.entries(obj)) {
        assertNoArrayItems(value, `${path}.${key}`);
      }
    }

    assertNoArrayItems(diagramTool.inputSchema, "draw_diagram");
  });

  it("draw_diagram's domain and yRange still constrain to exactly 2 numbers after normalization", () => {
    const diagramTool = TOOLS.find((t) => t.name === "draw_diagram")!;
    const schema = diagramTool.inputSchema as {
      properties: { diagram: { anyOf: Record<string, unknown>[] } };
    };
    const curveVariant = schema.properties.diagram.anyOf.find(
      (v) => (v as { properties?: { kind?: { const?: string } } }).properties?.kind?.const === "curve"
    ) as {
      properties: {
        domain: { type: string; items: { type: string }; minItems: number; maxItems: number };
        yRange: { type: string; items: { type: string }; minItems: number; maxItems: number };
      };
    };
    expect(curveVariant).toBeDefined();
    for (const field of [curveVariant.properties.domain, curveVariant.properties.yRange]) {
      expect(field.type).toBe("array");
      expect(field.items).toEqual({ type: "number" });
      expect(field.minItems).toBe(2);
      expect(field.maxItems).toBe(2);
    }
  });

  it("new_page's schema takes no required fields", () => {
    const newPageTool = TOOLS.find((t) => t.name === "new_page")!;
    const schema = newPageTool.inputSchema as { required?: string[] };
    expect(schema.required ?? []).toEqual([]);
  });

  it("maps every tool name to its BoardStep kind", () => {
    expect(TOOL_TO_STEP_KIND).toEqual({
      write_math: "math",
      write_text: "text",
      draw_diagram: "diagram",
      new_page: "new_page",
    });
  });
});
