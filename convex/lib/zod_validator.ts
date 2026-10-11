import { v, type GenericValidator, type Validator } from "convex/values";
import type { z } from "zod";

/**
 * Derives the Convex validator for a Zod schema so a stored shape has one
 * definition. Bounds and refinements cannot be stored; mutations still parse
 * with the Zod schema before writing.
 */
export function zodValidator<T extends z.ZodType>(
  schema: T,
): Validator<z.output<T>, "required", string> {
  return convert(schema) as Validator<z.output<T>, "required", string>;
}

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  values?: unknown[];
  entries?: Record<string, string | number>;
  options?: z.ZodType[];
  element?: z.ZodType;
  innerType?: z.ZodType;
};

function literals(values: unknown[]): GenericValidator {
  const each = values.map((value) => v.literal(value as string | number));
  return each.length === 1 ? each[0] : v.union(...each);
}

function convert(schema: z.ZodType): GenericValidator {
  const def = schema._zod.def as Def;
  switch (def.type) {
    case "string":
      return v.string();
    case "number":
      return v.number();
    case "boolean":
      return v.boolean();
    case "literal":
      return literals(def.values!);
    case "enum":
      return literals(Object.values(def.entries!));
    case "array":
      return v.array(convert(def.element!));
    case "nullable":
      return v.union(convert(def.innerType!), v.null());
    case "optional":
      return v.optional(convert(def.innerType!));
    case "union":
      return v.union(...def.options!.map(convert));
    case "object":
      return v.object(
        Object.fromEntries(
          Object.entries(def.shape!).map(([key, field]) => [
            key,
            convert(field),
          ]),
        ),
      );
    default:
      throw new Error(`Zod type "${def.type}" has no Convex validator`);
  }
}
