import { v, type GenericValidator, type Validator } from "convex/values";
import { z } from "zod";

export function zodValidator<T extends z.ZodType>(
  schema: T,
): Validator<z.output<T>, "required", string> {
  return convert(schema) as Validator<z.output<T>, "required", string>;
}

function literals(values: unknown[]): GenericValidator {
  const each = values.map((value) => v.literal(value as string | number));
  return each.length === 1 ? each[0] : v.union(...each);
}

function convert(schema: z.core.$ZodType): GenericValidator {
  switch (true) {
    case schema instanceof z.ZodString:
      return v.string();
    case schema instanceof z.ZodNumber:
      return v.number();
    case schema instanceof z.ZodBoolean:
      return v.boolean();
    case schema instanceof z.ZodLiteral:
      return literals([...schema.values]);
    case schema instanceof z.ZodEnum:
      return literals(Object.values(schema.enum));
    case schema instanceof z.ZodArray:
      return v.array(convert(schema.element));
    case schema instanceof z.ZodNullable:
      return v.union(convert(schema.unwrap()), v.null());
    case schema instanceof z.ZodOptional:
      return v.optional(convert(schema.unwrap()));
    case schema instanceof z.ZodUnion:
      return v.union(...schema.options.map(convert));
    case schema instanceof z.ZodObject:
      return v.object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([key, field]) => [
            key,
            convert(field),
          ]),
        ),
      );
    default:
      throw new Error(
        `Zod type "${schema._zod.def.type}" has no Convex validator`,
      );
  }
}
