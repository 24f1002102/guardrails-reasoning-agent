# Hackathon Submission Plan

## Track

Reasoning Agents

## Project title

Social Media Guardrails Reasoning Agent

## Tagline

An AI agent that assesses unsafe amplification risk, simulates coordinated behavior, grounds enforcement in Foundry IQ policy citations, deliberates over alternatives, and applies proportionate social media guardrails.

## Required Microsoft IQ layer

Foundry IQ (Azure AI Search API adapter with local synthetic policy fallback)

## What to emphasize in the video

1. **Not a static moderation classifier:** Highlight that it is a live-grounded, multi-agent reasoning platform.
2. **Real-time Streaming Reasoning Timeline:** Show the Server-Sent Events (SSE) reasoning steps streaming live in the UI (Content -> Amplification -> Coordination -> Policy -> Governance -> Enforcement) with glowing active thinking animations.
3. **Live Web-Grounding & Context:** Demonstrate how the Content Agent queries a live web search utility to detect rumor velocity and verify breaking event contexts in real time.
4. **Dynamic 100+ Agent Propagation Simulation:** Showcase the interactive network graph displaying post propagation. Hover over nodes to inspect simulated user profiles and see coordinated bot engagement in action.
5. **Azure Ecosystem Integration:** Emphasize that the policy grounding connects to Azure AI Search, and the governance deliberation agent utilizes Azure OpenAI (GPT-4o) with robust local fallbacks.
6. **Proportionate Enforcement & Transparency:** Walk through alternative action scoring, least restrictive intervention selection, clear citations, and one-click audit rollbacks.

## Five-minute demo script

### 0:00-0:30 - Problem

Unsafe posts can amplify before manual review catches them. Content classifiers alone do not reason about spread pressure, coordination signals, policy, alternative actions, or proportional response.

### 0:30-1:00 - Solution

This app is a live-grounded social media guardrails reasoning agent. It performs real-time step-by-step reasoning via Server-Sent Events, integrates live web search to verify rumors, retrieves policy through Azure AI Search, deliberates with Azure OpenAI GPT-4o, and visualizes network propagation across 100+ agents.

### 1:00-2:20 - Live scenario & Network Propagation

Select a civic rumor scenario. Click Analyze and watch the agent steps stream in live with pulsing "thinking" indicators. Highlight the 100+ node network graph simulation: watch the post spread through different community clusters. Hover over nodes to inspect individual simulated user profiles and see bots coordinate in real time.

### 2:20-3:15 - Reasoning chain & Deliberation

Walk through the streamed agent timeline, noting the live search citations in the Content Agent and the GPT-4o reasoning in the Governance Deliberation Agent. Show the **Alternative Actions Considered** panel. Explain how the agent automatically computes and chooses the least restrictive effective action.

### 3:15-4:10 - Foundry IQ and safety

Show citations. Say that policy-grounded extractive evidence prevents unsupported enforcement. Show the audit record and idempotency key.

### 4:10-5:00 - Why it matters

The agent reduces unsafe amplification while preserving expression through labels, source requirements, throttling, trend pauses, and human review before removal.

## Judge Q&A

### Is this just content moderation?

No. Content moderation classifies a post. This agent reasons over amplification risk, coordinated behavior, policy evidence, intervention proportionality, alternatives considered, and auditability.

### Where is Foundry IQ?

The policy retrieval layer is designed around Foundry IQ: a knowledge base returns permission-aware, extractive policy citations that the enforcement agent must use before making a decision. Local mode uses synthetic policy data; final mode should use a configured Foundry IQ retrieval endpoint.

### Is this censorship?

The agent uses least restrictive intervention first. It prioritizes context labels, source requirements, distribution throttling, trend pause, and human review. Removal is reserved for extreme or policy-mandated cases.

### How do you avoid hallucinated policy?

The enforcement agent cites retrieved policy extracts. If citation quality is low or no policy matches, the system escalates uncertainty to human review.

### How do you make the decision reliable?

The same post version produces the same idempotency key and action. Decisions are audit logged and reversible when the action is not an emergency containment.

## Rubric mapping

### Accuracy and relevance - 20 percent

*   **Reasoning Agent Track:** Built around a multi-agent orchestration architecture that streams reasoning steps in real-time using Server-Sent Events (SSE).
*   **Required Foundry IQ Layer:** Grounded policy retrieval integrates directly with Azure AI Search, retrieving extractive citations so the agent does not hallucinate enforcement policies. Includes a local synthetic fallback.

### Reasoning and multi-step thinking - 20 percent

*   **Step-by-step Streaming:** Every phase of analysis (Content -> Amplification -> Coordination -> Policy -> Governance -> Enforcement) is streamed progressively to the UI, highlighting active "thinking" states.
*   **Azure OpenAI (GPT-4o) Deliberation:** The final governance decision is deliberated by GPT-4o, incorporating content signals, risk metrics, and policy citations to construct natural language rationales.
*   **Explainable Heuristics:** The system computes risk utilizing a transparent, weighted heuristic model (documented in the README) rather than opaque "black-box" classifications.

### Creativity and originality - 15 percent

*   **Live Web-Grounding:** Incorporates live web search extraction to detect rumor velocity and verify breaking event contexts dynamically.
*   **100+ Agent Propagation Simulation:** Simulates virality and coordinated bot behavior in real-time across a generated social graph (95-140 nodes clustered by demographic/community segments), with interactive tooltips for inspecting individual node profiles on hover.

### User experience and presentation - 15 percent

*   **Live Command Center:** A dark, high-performance UI using smooth CSS transitions, glowing agent pulse states, and real-time streaming timelines.
*   **Interactive Visualizations:** Canvas-based network spread and amplification graphs that visually react as the reasoning stream unfolds.

### Reliability and safety - 20 percent

*   **Auditability & Rollback:** Every enforcement decision generates a structured audit trail with an idempotency key (factoring in reach metrics) and supports one-click rollbacks.
*   **Security Hardening:** Implements strict environment-only API keys, rate-limiting (20 req/IP/min) to prevent abuse, and Content-Security-Policy (CSP) headers to isolate the dashboard.

### Community vote - 10 percent

*   Frame it as protecting communities from unsafe amplification and bot manipulation, rather than blocking speech.

## Final submission checklist

- Public GitHub repository
- README with setup instructions
- Demo video under 5 minutes
- Architecture diagram
- Foundry IQ explanation
- Synthetic data disclaimer
- Responsible AI and safety section
- Public demo scenario
- Live Foundry IQ configuration or clear note that local mode simulates the knowledge layer
- No confidential data
