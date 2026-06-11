import type { AuditFinding } from "../contracts/audit-finding.js";
import { isObject, isString, isStringArray, isNumber } from "../contracts/result.js";
import { extractEvidenceKeywords } from "../clusterer/evidence-keywords.js";
import { jaccard } from "../clusterer/jaccard.js";
import type { Tool, ToolResult } from "./types.js";

type FindSimilarFindingsResult = { findings: AuditFinding[] };

const DEFAULT_LIMIT = 5;

export const findSimilarFindingsTool: Tool<FindSimilarFindingsResult> = {
  name: "find_similar_findings",
  description:
    "Find AuditFindings for an agent that are similar to given evidence keywords or text. Ranked by Jaccard similarity over evidence_keywords, descending. Useful for surfacing similar past cases in the review card.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Search findings for this agent." },
      evidence_keywords: {
        type: "array",
        items: { type: "string" },
        description: "Optional: pre-computed keyword list to match against.",
      },
      text: {
        type: "string",
        description: "Optional: raw text from which keywords are extracted (used when evidence_keywords not given).",
      },
      limit: { type: "number", description: "Optional: max results (default 5)." },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },

  async run(input: unknown, ctx): Promise<ToolResult<FindSimilarFindingsResult>> {
    if (!isObject(input)) {
      return { ok: false, error: "input must be a non-null object" };
    }
    const agent_id = input["agent_id"];
    if (!isString(agent_id) || agent_id.length === 0) {
      return { ok: false, error: "agent_id must be a non-empty string" };
    }

    const evidenceKeywordsRaw = input["evidence_keywords"];
    const textRaw = input["text"];
    const limitRaw = input["limit"];

    let queryKeywords: string[];

    if (isStringArray(evidenceKeywordsRaw)) {
      queryKeywords = evidenceKeywordsRaw;
    } else if (isString(textRaw)) {
      queryKeywords = extractEvidenceKeywords([textRaw]);
    } else {
      return {
        ok: false,
        error: "either evidence_keywords (string array) or text (string) must be provided",
      };
    }

    const limit = isNumber(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;

    const findings = await ctx.memory.listFindings({ agent_id });

    const scored = findings.map((f) => ({
      finding: f,
      score: jaccard(queryKeywords, f.evidence_keywords),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.finding.finding_id.localeCompare(b.finding.finding_id);
    });

    return {
      ok: true,
      data: { findings: scored.slice(0, limit).map((s) => s.finding) },
    };
  },
};
