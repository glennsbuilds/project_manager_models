import { PrimitiveDefinition } from "./parser.ts";
import { mapMarkdownTypeToTypeScript } from "./typeConverter.ts";

export function generateInterfaces(primitives: PrimitiveDefinition[]): string {
  let output = `// Auto-generated from contracts/domain/PRIMITIVES.md
// Do not edit manually

`;

  for (const primitive of primitives) {
    output += generateInterface(primitive);
    output += "\n\n";
  }

  return output;
}

function generateInterface(primitive: PrimitiveDefinition): string {
  const fieldLines = primitive.fields.map((field) => {
    const tsType = mapMarkdownTypeToTypeScript(field.type);
    const optional = field.optional ? "?" : "";
    return `  ${field.name}${optional}: ${tsType};`;
  });

  return `/**
 * ${primitive.description}
 */
export interface ${primitive.name} {
${fieldLines.join("\n")}
}`;
}
