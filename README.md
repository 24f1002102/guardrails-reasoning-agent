# Social Media Guardrails Reasoning Agent

Social Media Guardrails Committee is a multi-agent governance system that helps platforms make transparent, policy-grounded moderation decisions.
Instead of asking only whether content is harmful, the system determines the least restrictive effective intervention by combining content analysis, amplification risk assessment, coordination detection, policy retrieval, governance deliberation, and auditable enforcement.

This project is designed for the Microsoft Agents League Hackathon 2026, Reasoning Agents track.

## Key Capabilities

- Multi-agent governance workflow
- Policy-grounded decision making
- Least restrictive effective intervention
- Alternative-action deliberation
- Explainable enforcement decisions
- Audit trail and rollback support

<img width="1328" height="618" alt="Screenshot 2026-06-14 123015" src="https://github.com/user-attachments/assets/41a1066e-e501-42c4-a198-50ed37507224" />

<img width="1312" height="600" alt="Screenshot 2026-06-14 123105" src="https://github.com/user-attachments/assets/c35e3951-702c-4bf6-b15a-191c0d51c5b7" />

<img width="640" height="626" alt="Screenshot 2026-06-14 123304" src="https://github.com/user-attachments/assets/1be1ffa6-66a5-46e5-93ae-154a2411d944" />

<img width="637" height="607" alt="Screenshot 2026-06-14 123330" src="https://github.com/user-attachments/assets/8686630d-d26d-4746-aac1-16999d3187a4" />


## Innovation Highlights

### Multi-Agent Governance
Rather than producing a single moderation score, the system uses specialized agents to evaluate content risk, amplification pressure, coordination signals, policy grounding, governance outcomes, and enforcement actions.
### Policy-Grounded Decisions
Governance recommendations are supported by policy evidence and citations, enabling transparent and auditable decision making.
### Least Restrictive Effective Action
The platform prioritizes proportionate interventions such as context labels, source requirements, throttling, and human review before considering stronger enforcement actions.
### Explainable Governance
Every recommendation includes supporting evidence, alternative actions considered, and a complete audit trail for review and rollback.

## Run locally

Requires Node.js 18 or newer.

```powershell
npm test
npm start
```

Open http://localhost:4173.

No third-party packages are required for the local demo.

## Architecture

```mermaid
flowchart LR
  Post["Social post + engagement metrics"] --> Signals["Content signal agent"]
  Signals --> Amplification["Amplification risk agent"]
  Amplification --> Coordination["Coordination simulation agent"]
  Coordination --> IQ["Foundry IQ policy retrieval"]
  IQ --> Deliberation["Governance deliberation agent"]
  Deliberation --> Alternatives["Alternative actions considered"]
  Alternatives --> Guardrails["Guardrail enforcement agent"]
  Guardrails --> Dashboard["Transparency dashboard"]
  Guardrails --> Audit["Idempotent audit trail"]
```

## API

### `POST /api/analyze`

Request:

```json
{
  "postText": "Breaking: polling locations changed tonight...",
  "author": {
    "handle": "@citywatch_now",
    "accountAgeDays": 46,
    "followerCount": 42000,
    "verified": false,
    "priorViolations": 1
  },
  "metrics": {
    "minutesSincePosted": 18,
    "likes": 3100,
    "shares": 2600,
    "replies": 780,
    "reports": 61
  },
  "context": {
    "topic": "election",
    "eventWindow": "active",
    "region": "demo-region",
    "language": "en",
    "mediaType": "text"
  },
  "actor": {
    "role": "public-demo"
  }
}
```

Response includes:

- `contentSignals`
- `amplificationRisk`
- `botSimulation`
- `foundryIq.citations`
- `alternativeActions`
- `governanceDeliberation`
- `enforcement`
- `reasoningTimeline`
- `auditRecord`

## Foundry IQ integration

Local mode uses `src/data/policies.js`, a synthetic policy corpus that mirrors the Foundry IQ contract for hackathon demo development. This keeps the app runnable without uploading confidential data.

For final hackathon submission, connect a real Foundry IQ / Azure AI Search knowledge base:

1. Create a Foundry IQ knowledge base with synthetic or public policy documents.
2. Use extractive retrieval so the agent reasons over cited policy snippets.
3. Configure the app:

```powershell
$env:FOUNDRY_IQ_MODE="live"
$env:FOUNDRY_IQ_RETRIEVAL_URL="<your exact knowledge base retrieval endpoint>"
$env:FOUNDRY_IQ_API_KEY="<optional if required>"
$env:FOUNDRY_IQ_BEARER_TOKEN="<optional if required>"
npm start
```

> [!NOTE]
> Set `FOUNDRY_IQ_MODE=live` with your Azure AI Search endpoint for production use. If not set (or left as `mock`), the reasoning engine will utilize the local synthetic policy corpus (**`local-policy-corpus`**) instead of the live API.


The app sends:

- `query`
- `context`
- `retrievalReasoningEffort: "medium"`
- `outputMode: "extractiveData"`

If live retrieval fails, the API falls back to the local synthetic corpus and returns a warning. For the final judge demo, show live retrieval working or clearly disclose local demo mode.

## Explainability

The platform uses transparent scoring models rather than opaque moderation decisions. Risk assessments are generated from multiple explainable signals including amplification pressure, coordination indicators, source uncertainty, engagement velocity, and topic sensitivity.

Detailed scoring methodology is available in docs/scoring-model.md.

## Safety design

- Synthetic demo data only.
- No confidential data required.
- User-generated content is treated as untrusted input.
- High-risk low-citation cases route to human review.
- The agent uses least restrictive intervention first.
- Every applied decision has an idempotency key and audit record.
- The dashboard shows citations instead of hidden reasoning.

## Limitations

- The amplification risk model is a transparent heuristic for demo purposes, not a production prediction system.
- The coordination simulation is a risk model, not a forensic attribution engine.
- The local policy corpus is synthetic. Use real Foundry IQ policy sources for official submission.
- Production moderation requires fairness testing, appeals operations, reviewer tooling, and jurisdiction-specific legal review.
