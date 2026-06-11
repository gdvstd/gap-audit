/**
 * Sales CRM simulated tools.
 */
import type { SimTool, ToolResult } from "./types.js";

export const updateCrm: SimTool = {
  name: "update_crm",
  description: "Update the CRM with contact or opportunity data.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      field: { type: "string", description: "CRM field to update" },
      value: { type: "string", description: "Value to set" },
      store: { type: "string", description: "CRM store (crm_shared, internal_notes)" },
    },
    required: ["field", "value"],
  },
  run(input: Record<string, unknown>): ToolResult {
    const field = typeof input["field"] === "string" ? input["field"] : "field";
    const value = typeof input["value"] === "string" ? input["value"] : "";
    return {
      status: "ok",
      output: `CRM updated: ${field} = ${value.slice(0, 100)}`,
    };
  },
};

export const draftEmail: SimTool = {
  name: "draft_email",
  description: "Draft a follow-up email to a contact.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["to", "subject", "body"],
  },
  run(input: Record<string, unknown>): ToolResult {
    const to = typeof input["to"] === "string" ? input["to"] : "recipient";
    const subject = typeof input["subject"] === "string" ? input["subject"] : "Follow-up";
    return {
      status: "ok",
      output: `Email draft created for ${to}: ${subject}`,
    };
  },
};

export const logNote: SimTool = {
  name: "log_note",
  description: "Log a note to internal notes store.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      store: { type: "string", description: "Note store (e.g. internal_notes)" },
      note: { type: "string" },
    },
    required: ["note"],
  },
  run(input: Record<string, unknown>): ToolResult {
    const note = typeof input["note"] === "string" ? input["note"] : "";
    return {
      status: "ok",
      output: `Note logged: ${note.slice(0, 200)}`,
    };
  },
};

export const SALES_TOOLS: SimTool[] = [updateCrm, draftEmail, logNote];
