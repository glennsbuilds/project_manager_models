import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { parsePrimitives } from "./parser.ts";
import { parseTransitions } from "./transitionsParser.ts";
import { generateInterfaces } from "./generateInterfaces.ts";
import { generateSchemas } from "./generateSchemas.ts";
import { generateCloudEvents } from "./generateCloudEvents.ts";

const OUTPUT_DIR = resolve(import.meta.dirname, "../packages/models/src");

function ensureDirectory(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function generate() {
  console.log("🔍 Parsing contracts/domain/PRIMITIVES.md...");
  const { primitives } = parsePrimitives("contracts/domain/PRIMITIVES.md");
  console.log(`✓ Found ${primitives.length} primitives`);

  console.log("🔍 Parsing contracts/domain/TRANSITIONS.md...");
  const { transitions } = parseTransitions("contracts/domain/TRANSITIONS.md");
  console.log(`✓ Found ${transitions.length} transitions (${transitions.filter((t) => !t.futureWork).length} implemented)`);

  console.log("\n📝 Generating TypeScript interfaces...");
  const interfaceCode = generateInterfaces(primitives);
  const interfacePath = resolve(OUTPUT_DIR, "types.ts");
  ensureDirectory(interfacePath);
  writeFileSync(interfacePath, interfaceCode);
  console.log(`✓ Generated ${interfacePath}`);

  console.log("📝 Generating Zod schemas...");
  const schemaCode = generateSchemas(primitives);
  const schemaPath = resolve(OUTPUT_DIR, "schemas.ts");
  ensureDirectory(schemaPath);
  writeFileSync(schemaPath, schemaCode);
  console.log(`✓ Generated ${schemaPath}`);

  console.log("📝 Generating CloudEvent types...");
  const cloudEventCode = generateCloudEvents(transitions);
  const cloudEventPath = resolve(OUTPUT_DIR, "cloudEvents.ts");
  ensureDirectory(cloudEventPath);
  writeFileSync(cloudEventPath, cloudEventCode);
  console.log(`✓ Generated ${cloudEventPath}`);

  console.log("\n✅ Code generation complete!");
  console.log(`\nGenerated files:`);
  console.log(`  - packages/models/src/types.ts`);
  console.log(`  - packages/models/src/schemas.ts`);
  console.log(`  - packages/models/src/cloudEvents.ts`);
}

generate();
