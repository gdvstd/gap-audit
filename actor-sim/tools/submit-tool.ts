/**
 * Terminal submit_result tool — called by agent to finish its run.
 */
import type { SimTool, ToolResult } from "./types.js";

export const submitResult: SimTool = {
  name: "submit_result",
  description:
    "Terminal tool: call this to finish the task and report the final outcome. " +
    "The runner will stop the loop when this is called.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      final_output: {
        type: "string",
        description: "The final answer or output to return to the user.",
      },
      status: {
        type: "string",
        enum: ["resolved", "failed", "needs_review", "blocked"],
        description: "Terminal status of the task.",
      },
      confidence: {
        type: "number",
        description: "Agent confidence in the result (0.0 - 1.0).",
      },
      declared_goal: {
        type: "string",
        description: "The goal the agent set out to accomplish.",
      },
    },
    required: ["final_output", "status", "confidence"],
  },
  run(input: Record<string, unknown>): ToolResult {
    const output =
      typeof input["final_output"] === "string" ? input["final_output"] : "Task complete.";
    return {
      status: "ok",
      output,
    };
  },
};
