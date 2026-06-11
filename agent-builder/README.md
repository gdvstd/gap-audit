# SilentOps — Agent Builder + Partner MCP Integration

This directory holds the **track-qualifying** integration for the Google Cloud Rapid Agent Hackathon: the SilentOps audit workflow runs in **Google Cloud Agent Builder** and meaningfully integrates **two partner MCP servers** — **Arize MCP** (submission track) and **MongoDB MCP**.

## Why this satisfies the requirement

The hackathon requires: *"meaningfully integrate at least one participating partner's MCP server,"* built with *Gemini + Google Cloud Agent Builder + partner MCP*. SilentOps does exactly that:

| Component | Role |
|---|---|
| **Gemini** | Reasoning engine — runs the 7 audit lenses over normalized artifacts |
| **Agent Builder** | Orchestrates the audit workflow and calls the MCP servers as tools |
| **Arize Phoenix MCP** (`@arizeai/phoenix-mcp`) | INGEST boundary — introspect own traces/spans/sessions at runtime; write regression evals back as dataset examples |
| **MongoDB MCP** | MEMORY boundary — store findings/clusters, search failure patterns |

## Files

- `audit-workflow.json` — the workflow definition (steps + tool wiring), backend-neutral.
- `mcp-servers.json` — registration of the Phoenix and MongoDB MCP servers (transport, auth, tools used). Secrets are env-referenced; fill at deploy time.
- **`DEPLOY.md`** — step-by-step deployment guide (ADK → Vertex AI Agent Engine).
- `GapAudit/` — the deployable ADK agent: `agent.py` (Gemini + Phoenix MCP + MongoDB MCP), `requirements.txt`, `install.sh` (installs Node so the npx MCP servers run).

## Privacy boundary (important)

MCP servers are wired **only at the I/O boundaries**, never at the agent's reasoning core:

- **Phoenix MCP → Normalizer**: raw traces (from `list-traces`/`get-spans`) are redacted and masked (`[email detected · routine]`) *before* any reasoning. The Gemini steps never receive raw traces.

> **Track requirement (verified 2026-06):** the Arize track qualifies on the **Phoenix MCP server** (`@arizeai/phoenix-mcp`), configured so the agent can *introspect its own operational data at runtime*. It is stdio (`npx -y @arizeai/phoenix-mcp@latest --baseUrl $PHOENIX_HOST --apiKey $PHOENIX_API_KEY`) and reads from **Phoenix Cloud** (app.phoenix.arize.com) — a distinct sink from Arize AX, so traces must be sent to Phoenix's collector for the MCP to see them.
- **MongoDB MCP**: only privacy-safe records (entity types, redacted snippets, hashes) are written.

This keeps **privacy by construction** intact while still meaningfully using the partner MCP servers.

## Deploy

**See [`DEPLOY.md`](DEPLOY.md) for the full step-by-step guide** (ADK → Vertex AI Agent Engine). In short:

1. Build the agent with Google ADK (`GapAudit/agent.py`) — Gemini + `McpToolset` for Phoenix MCP and MongoDB MCP.
2. Test locally: `adk run ./GapAudit` (or `adk web ./GapAudit`).
3. Deploy: `adk deploy agent_engine --project=… --region=… --staging_bucket=gs://… --install_script=./GapAudit/install.sh ./GapAudit`.
4. Point the SilentOps app at the deployed agent via `AGENT_BUILDER_ENABLED=true` + `AGENT_BUILDER_APP_ID=<reasoningEngines/…>`; the app triggers it through `WorkflowOrchestratorAdapter` (`lib/integrations/workflow-orchestrator.ts`), falling back to in-process execution if unreachable.

## Fallback (local / seeded demo)

When Agent Builder is not configured, the app runs the **same pipeline in-process** — Arize HTTP/OTLP, the MongoDB Node.js driver, and the Gemini SDK — via the orchestrator's local path. Same boundaries, just not through MCP. This is why `pnpm dev` works offline without any MCP access.

## Status

- Workflow + MCP registration definitions: **complete** (this directory).
- Activation requires a deployed Agent Builder app + reachable MCP endpoints (deploy-time), like the other live adapters.
- Tool names in `mcp-servers.json` follow each server's documented surface; confirm against the deployed MCP server version before the final run.
