import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { parsePrimitives } from "./parser.ts";
import { parseTransitions } from "./transitionsParser.ts";
import { generateInterfaces } from "./generateInterfaces.ts";
import { generateSchemas } from "./generateSchemas.ts";
import { generateCloudEvents } from "./generateCloudEvents.ts";
import { parsePipeline } from "./pipelineParser.ts";
import { generateStepFunction } from "./generateStepFunction.ts";

const OUTPUT_DIR = resolve(import.meta.dirname, "../packages/models/src");
const CDK_OUTPUT_DIR = resolve(import.meta.dirname, "../packages/pipeline-cdk/src");

function ensureDirectory(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function generate() {
  console.log("🔍 Parsing contracts/platform/domain/PRIMITIVES.md...");
  const { primitives } = parsePrimitives("contracts/platform/domain/PRIMITIVES.md");
  console.log(`✓ Found ${primitives.length} primitives`);

  console.log("🔍 Parsing contracts/platform/domain/TRANSITIONS.md...");
  const { transitions } = parseTransitions("contracts/platform/domain/TRANSITIONS.md");
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

  console.log("\n🔍 Parsing contracts/project-manager/services/conversation_pipeline.md...");
  const pipeline = parsePipeline("contracts/project-manager/services/conversation_pipeline.md");
  console.log(`✓ Found pipeline: ${pipeline.metadata.name} (${pipeline.steps.length} steps, ${pipeline.branches.length} branches)`);

  console.log("📝 Generating Step Function CDK construct...");
  const cdkCode = generateStepFunction(pipeline);
  const cdkPath = resolve(CDK_OUTPUT_DIR, "conversationPipeline.ts");
  ensureDirectory(cdkPath);
  writeFileSync(cdkPath, cdkCode);
  console.log(`✓ Generated ${cdkPath}`);

  console.log("\n✅ Code generation complete!");
  console.log(`\nGenerated files:`);
  console.log(`  - packages/models/src/types.ts`);
  console.log(`  - packages/models/src/schemas.ts`);
  console.log(`  - packages/models/src/cloudEvents.ts`);
  console.log(`  - packages/pipeline-cdk/src/conversationPipeline.ts`);
}

generate();
