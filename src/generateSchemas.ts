import { PrimitiveDefinition } from "./parser.ts";
import { mapMarkdownTypeToZod } from "./typeConverter.ts";

export function generateSchemas(primitives: PrimitiveDefinition[]): string {
  let output = `// Auto-generated from contracts/domain/PRIMITIVES.md
// Do not edit manually

import { z } from "zod";

`;

  for (const primitive of primitives) {
    output += generateSchema(primitive);
    output += "\n\n";
  }

  return output;
}

function generateSchema(primitive: PrimitiveDefinition): string {
  const fieldLines = primitive.fields.map((field) => {
    const zodType = mapMarkdownTypeToZod(field.type);
    const optional = field.optional ? ".optional()" : "";
    return `  ${field.name}: ${zodType}${optional},`;
  });

  return `/**
 * ${primitive.description}
 */
export const ${primitive.name}Schema = z.object({
${fieldLines.join("\n")}
}).strict();

export type ${primitive.name} = z.infer<typeof ${primitive.name}Schema>;`;
}
