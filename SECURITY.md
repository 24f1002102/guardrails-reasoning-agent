# Security and Responsible AI Review

## Data handling

This project uses synthetic posts, synthetic accounts, and synthetic policy documents. Do not upload confidential, personal, customer, internal, or regulated data for the hackathon demo.

## Threat model

### Prompt injection

Social posts are untrusted input. The agent does not allow post text to modify instructions, retrieval policy, or tool behavior. Prompt-injection terms are treated as risk signals, not executable instructions.

### Hallucinated policy

The enforcement agent must cite retrieved policy evidence. If no useful policy citation exists, the app routes to human review instead of inventing a rule.

### Duplicate enforcement

The API generates a deterministic post version and idempotency key. Replaying the same post version does not create conflicting enforcement records.

### Over-enforcement

The decision ladder prefers:

1. allow
2. context label
3. source requirement
4. distribution throttle
5. trend pause and human review
6. emergency containment

Removal-like actions should be exceptional and reviewed.

### Sensitive data exposure

The demo avoids copying private data into logs. Production systems should redact PII before telemetry, apply retention limits, and use managed identities for Azure resources.

## Production hardening

- Replace local policy data with a Foundry IQ knowledge base.
- Use Microsoft Entra ID or managed identity where possible.
- Add Azure AI Content Safety as a signal, not the whole decision.
- Add fairness tests across languages, regions, and communities.
- Add reviewer workflows and appeal handling.
- Add structured monitoring for false positives, false negatives, latency, and rollback rate.
- Perform legal and policy review before real-world enforcement.
