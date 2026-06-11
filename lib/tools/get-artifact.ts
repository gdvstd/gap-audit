import type { AuditArtifact } from "../contracts/audit-artifact.js";
import { isObject, isString } from "../contracts/result.js";
import type { Tool, ToolResult } from "./types.js";

type GetArtifactResult = { artifact: AuditArtifact | null };

export const getArtifactTool: Tool<GetArtifactResult> = {
  name: "get_artifact",
  description:
    "Retrieve a GapAudit service audit artifact by task_id. Returns null if the artifact does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task_id of the artifact to retrieve." },
    },
    required: ["task_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<GetArtifactResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const task_id = input["task_id"];
    if (!isString(task_id) || task_id.length === 0) {
      return { ok: false, error: "task_id must be a non-empty string" };
    }
    const artifact = await ctx.memory.getArtifact(task_id);
    return {
      ok: true,
      data: { artifact },
    };
  },
};
