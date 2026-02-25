import { readFileSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";

// --- Parsed types ---

export interface RetryConfig {
  max_attempts: number;
  backoff_rate: number;
  interval_seconds: number;
}

export interface OutputField {
  name: string;
  type: string;
  optional?: boolean;
  fields?: OutputField[];
  items?: OutputField[];
}

export interface InputField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  items?: OutputField[];
}

export interface ChoiceBranch {
  match: string;
  goto: string;
}

export interface StepDefinition {
  name: string;
  type: "Lambda" | "BedrockAgentCore" | "Choice" | "Placeholder" | "Succeed";
  description?: string;
  retry?: RetryConfig;
  timeout_seconds?: number;
  output?: OutputField[];
  errors?: Record<string, { description: string; action: string }>;
  // Lambda-specific
  branch_on?: string;
  paths?: Record<string, unknown>;
  writes?: unknown[];
  emits?: unknown[];
  condition?: string;
  // Choice-specific
  input_field?: string;
  branches?: ChoiceBranch[];
  default?: string;
  // Agent-specific
  agent_id_env?: string;
  input?: string;
}

export interface BranchDefinition {
  name: string;
  steps: StepDefinition[];
}

export interface AgentDefinition {
  name: string;
  type: string;
  agent_id_env: string;
  description?: string;
  infrastructure_only?: boolean;
}

export interface EnvironmentVariable {
  name: string;
  source: "ssm" | "static";
  parameter?: string;
  value?: string;
}

export interface ErrorHandlingRule {
  step: string;
  retry?: RetryConfig;
  on_failure?: string;
  default?: string;
  notes?: string;
}

export interface PipelineMetadata {
  name: string;
  type: string;
  source: string;
}

export interface PipelineTrigger {
  type: string;
  event_source: string;
  detail_type: string;
}

export interface PipelineInput {
  fields: InputField[];
}

export interface ParsedPipeline {
  metadata: PipelineMetadata;
  trigger: PipelineTrigger;
  input: PipelineInput;
  steps: StepDefinition[];
  branches: BranchDefinition[];
  agents: AgentDefinition[];
  environment: EnvironmentVariable[];
  error_handling: ErrorHandlingRule[];
}

/**
 * Parse a pipeline contract markdown file into a typed pipeline definition.
 *
 * Extracts YAML blocks by section header (### Metadata, ### Steps, etc.)
 * and parses each with js-yaml.
 */
export function parsePipeline(filePath: string): ParsedPipeline {
  const content = readFileSync(resolve(filePath), "utf-8");
  const sections = extractYamlSections(content);

  const metadata = parseMetadata(sections["Metadata"]);
  const trigger = parseTrigger(sections["Trigger"]);
  const input = parseInput(sections["Input"]);
  const steps = parseSteps(sections["Steps"]);
  const branches = parseBranches(sections["Branches"]);
  const agents = parseAgents(sections["Agents"]);
  const environment = parseEnvironment(sections["Environment Variables"]);
  const error_handling = parseErrorHandling(sections["Error Handling"]);

  return {
    metadata,
    trigger,
    input,
    steps,
    branches,
    agents,
    environment,
    error_handling,
  };
}

/**
 * Extract YAML code blocks from markdown, keyed by their preceding ### header.
 */
function extractYamlSections(
  content: string
): Record<string, string> {
  const sections: Record<string, string> = {};

  // Match ### headers followed by a yaml fenced code block
  const sectionRegex =
    /^### (.+?)\n[\s\S]*?```yaml\n([\s\S]*?)```/gm;

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const header = match[1].trim();
    const yamlContent = match[2];
    sections[header] = yamlContent;
  }

  return sections;
}

function parseMetadata(yamlStr: string | undefined): PipelineMetadata {
  if (!yamlStr) throw new Error("Missing Metadata section");
  const raw = yaml.load(yamlStr) as Record<string, string>;
  return {
    name: raw.name,
    type: raw.type,
    source: raw.source,
  };
}

function parseTrigger(yamlStr: string | undefined): PipelineTrigger {
  if (!yamlStr) throw new Error("Missing Trigger section");
  const raw = yaml.load(yamlStr) as { trigger: Record<string, string> };
  const trigger = raw.trigger;
  return {
    type: trigger.type,
    event_source: trigger.event_source,
    detail_type: trigger.detail_type,
  };
}

function parseInput(yamlStr: string | undefined): PipelineInput {
  if (!yamlStr) throw new Error("Missing Input section");
  const raw = yaml.load(yamlStr) as { input: { fields: InputField[] } };
  return {
    fields: raw.input.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      description: f.description,
      items: f.items,
    })),
  };
}

function parseSteps(yamlStr: string | undefined): StepDefinition[] {
  if (!yamlStr) throw new Error("Missing Steps section");
  const raw = yaml.load(yamlStr) as { steps: Record<string, unknown>[] };
  return raw.steps.map((step) => step as StepDefinition);
}

function parseBranches(yamlStr: string | undefined): BranchDefinition[] {
  if (!yamlStr) throw new Error("Missing Branches section");
  const raw = yaml.load(yamlStr) as {
    branches: { name: string; steps: Record<string, unknown>[] }[];
  };
  return raw.branches.map((branch) => ({
    name: branch.name,
    steps: branch.steps.map((step) => step as StepDefinition),
  }));
}

function parseAgents(yamlStr: string | undefined): AgentDefinition[] {
  if (!yamlStr) throw new Error("Missing Agents section");
  const raw = yaml.load(yamlStr) as { agents: AgentDefinition[] };
  return raw.agents;
}

function parseEnvironment(
  yamlStr: string | undefined
): EnvironmentVariable[] {
  if (!yamlStr) throw new Error("Missing Environment Variables section");
  const raw = yaml.load(yamlStr) as {
    environment: EnvironmentVariable[];
  };
  return raw.environment;
}

function parseErrorHandling(
  yamlStr: string | undefined
): ErrorHandlingRule[] {
  if (!yamlStr) throw new Error("Missing Error Handling section");
  const raw = yaml.load(yamlStr) as { error_handling: ErrorHandlingRule[] };
  return raw.error_handling;
}
