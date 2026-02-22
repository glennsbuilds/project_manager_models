# Infrastructure and Coding Standards
## Infrastructure
The following standards for infrastructure should be enforced:
    1. IMPORTANT: No secrets or PII should be returned via any HTTP Endpoints. 
    1. IMPORTANT:  No secrets or PII should be written to application logs. 
    1. Our cloud provider is AWS. 
    1. All infrastructure should be pay-per-use with an emphasis on keeping costs low. 
    1. All infrastructure should be able to be easily scaled across regions
    1. Data storage should favor eventual consistency over ACID compliance. 
    1. We must use industry standard formats for messaging and observability
    1. All infrastructure should be deployed via code using industry standard tools. 
# Coding Standards
1. An industry standard programming language should be decided on and stuck with for all stacks
1. The latest LTS Run Time for that language should be used. 
1. The latest version of best of breed tools should be used for all frameworks. 
1. The definition of success for all application development should be that
    1. Code passes all unit tests and the tests have greater than 80% Coverage
    1. Code deploys successfully to the cloud
    1. All contract testing passes.
1. All intake lambda contracts (webhook handlers, event consumers) must include captured sample payloads from the real external system, stored in `contracts/samples/<trigger_name>/`
1. Contract test suites for intake lambdas must include golden-sample tests that dynamically discover and validate against all sample payloads in the corresponding samples directory
