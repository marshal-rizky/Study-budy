import { MathParseError, parseMath } from "@teacher/stroke-engine";

export type RenderableResult = { ok: true } | { ok: false; reason: string };

/**
 * Pre-flight check for whether the engine's TeX parser accepts `tex`,
 * without throwing. `parseMath` is the exact call `layoutScript` makes at
 * layout time -- if it throws `MathParseError` there, the whole script is
 * discarded downstream (Bug 4: a model emitted `\boxed{...}` and `\quad`,
 * outside the engine's TeX subset, and a correct 9-step derivation was lost
 * because nothing checked renderability before the step was accepted).
 *
 * `MathParseError`'s message already names the offending command/character
 * (e.g. `unknown command \boxed (at 16)`) -- that's surfaced verbatim as
 * `reason` so callers can hand it back to the model. Any other exception
 * type is a bug in the engine itself, not bad model output, and is left to
 * propagate rather than being reported as "not renderable".
 */
export function checkRenderable(tex: string): RenderableResult {
  try {
    parseMath(tex);
    return { ok: true };
  } catch (err) {
    if (err instanceof MathParseError) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
}
