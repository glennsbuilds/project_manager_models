# Code Fixer Agent Contract

## Overview

The Code Fixer Agent is the validation and correction step in the codeinator pipeline. It receives previously generated code alongside test output or lint errors and produces corrected source files. It runs after the Code Generator Agent and before artifact publication.

> **Note on prompt:** The system prompt for this agent is generated dynamically at invocation time. It is constructed from the failing output, the original behavioral contract, and the relevant coding standards. There is no static prompt file — see `policies/coding.md` for the standards that govern corrected output.

## Position in Pipeline

```
Code Generator Agent → [Code Fixer Agent] → Publish Artifacts
```

- **Receives:** generated source files + test/lint failure output from the previous step
- **Produces:** corrected TypeScript source files ready for artifact publication

## Input Shape

| Input | Description |
|-------|-------------|
| Generated files | The output of the Code Generator Agent (all files for the template type) |
| Failure output | Test runner output (Vitest), TypeScript compiler errors, or lint errors |
| Original contract | The same behavioral contract JSON the Code Generator received, for intent grounding |

## Output Shape

The same file set as the Code Generator Agent's output, with corrections applied. Only files that required changes are rewritten; passing files are passed through unchanged.

## Design Notes

- **Dynamic prompt:** The system prompt is built at runtime from the specific failures encountered. This allows the agent to focus precisely on what went wrong rather than re-evaluating the full contract.
- **Grounded in original intent:** The original behavioral contract is included in the prompt so the agent can distinguish a genuine bug from an intentional design decision. It should never "fix" correct behavior just because the test is poorly written.
- **Does not re-generate from scratch:** The Code Fixer makes targeted corrections. If the generated code is fundamentally wrong, the pipeline should escalate rather than loop indefinitely.
- **Standards-driven output:** Corrected code must still conform to `policies/coding.md`. The dynamic prompt injects the same standards sections used by the Code Generator to ensure consistency.
