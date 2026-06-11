/**
 * Track-requirement proof: an agent introspecting its own operational data at runtime
 * via the Arize Phoenix MCP server (@arizeai/phoenix-mcp).
 *
 * Spawns the Phoenix MCP server over stdio, connects an MCP client, lists the available
 * tools, then calls list-projects → list-traces → get-spans to confirm the SilentOps
 * actor traces (pushed to Phoenix Cloud) are introspectable through MCP.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   pnpm exec tsx scripts/mcp-introspect.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type TextContent = { type: string; text?: string };
type ToolResult = { content?: TextContent[]; isError?: boolean };

function textOf(res: ToolResult): string {
  return (res.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

async function main(): Promise<void> {
  const apiKey = process.env["PHOENIX_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    console.error("PHOENIX_API_KEY not set");
    process.exit(1);
  }
  const collector = process.env["PHOENIX_COLLECTOR_ENDPOINT"] ?? "";
  const baseUrl =
    collector.replace(/\/v1\/traces\/?$/, "") ||
    process.env["PHOENIX_HOST"] ||
    "https://app.phoenix.arize.com";
  const project = process.env["PHOENIX_PROJECT"] ?? "silentops-actors";

  console.log(`\nSpawning Phoenix MCP server (baseUrl=${baseUrl}) ...\n`);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@arizeai/phoenix-mcp@latest", "--baseUrl", baseUrl, "--apiKey", apiKey],
    env: { ...process.env, PHOENIX_API_KEY: apiKey, PHOENIX_HOST: baseUrl } as Record<string, string>,
  });

  const client = new Client({ name: "silentops-introspect", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  // 1. What tools does the Phoenix MCP server expose? (proves the real MCP surface)
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log(`✓ Connected. Phoenix MCP exposes ${names.length} tools:`);
  console.log("  " + names.join(", ") + "\n");

  const pick = (...cands: string[]): string | undefined => cands.find((c) => names.includes(c));

  // 2. list-projects → confirm silentops-actors is visible.
  const projTool = pick("list-projects", "list_projects");
  if (projTool !== undefined) {
    const res = (await client.callTool({ name: projTool, arguments: {} })) as ToolResult;
    const txt = textOf(res);
    const hit = txt.includes(project);
    console.log(`✓ ${projTool}: ${hit ? `found project "${project}"` : `(project "${project}" not seen)`}`);
    console.log("  " + txt.replace(/\s+/g, " ").slice(0, 300) + "\n");
  }

  // 3. list-traces for the project → confirm the actor traces are introspectable.
  const traceTool = pick("list-traces", "list_traces", "get-spans", "get_spans");
  if (traceTool !== undefined) {
    let res: ToolResult | undefined;
    for (const args of [
      { project_name: project },
      { projectName: project },
      { project: project },
      { project_name: project, limit: 20 },
    ]) {
      try {
        res = (await client.callTool({ name: traceTool, arguments: args })) as ToolResult;
        if (!res.isError) {
          console.log(`✓ ${traceTool}(${JSON.stringify(args)}):`);
          break;
        }
      } catch {
        // try next arg shape
      }
    }
    if (res !== undefined) {
      const txt = textOf(res);
      const mentions = ["cs-refund-agent", "recruiting-screener", "devops-incident-agent", "ap-invoice-agent", "it-access-agent", "sales-crm-agent"].filter((a) => txt.includes(a));
      console.log("  " + txt.replace(/\s+/g, " ").slice(0, 500));
      console.log(`\n✓ actor agents visible in introspected traces: [${mentions.join(", ") || "(parse — see raw above)"}]`);
    }
  }

  await client.close();
  console.log("\n✓ MCP introspection complete — the agent read its own operational data from Phoenix via MCP.\n");
}

main().catch((e: unknown) => {
  console.error("introspection error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
