import { describe, expect, it } from "vitest";
import { EVIDENCE_BRIEF_JSON_SCHEMA } from "../src/evidence/schema.js";

type SchemaNode = Record<string, unknown>;

const FORBIDDEN_KEYS = ["oneOf", "allOf", "anyOf", "not", "$ref", "$defs", "definitions"];

function childNodes(node: SchemaNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  const properties = node["properties"];
  if (typeof properties === "object" && properties !== null) {
    for (const value of Object.values(properties as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        out.push(value as SchemaNode);
      }
    }
  }
  const items = node["items"];
  if (typeof items === "object" && items !== null) {
    out.push(items as SchemaNode);
  }
  return out;
}

/** Walk the schema asserting every strict-subset rule. */
function assertStrictSubset(node: SchemaNode, path: string, seen: Set<unknown>, depth: number): void {
  expect(depth, `${path}: depth exceeds 10`).toBeLessThanOrEqual(10);
  expect(seen.has(node), `${path}: recursive schema`).toBe(false);
  seen.add(node);

  for (const key of FORBIDDEN_KEYS) {
    expect(node, `${path}: forbids ${key}`).not.toHaveProperty(key);
  }

  const declaresObject =
    node["type"] === "object" ||
    (Array.isArray(node["type"]) && (node["type"] as unknown[]).includes("object"));
  if (declaresObject) {
    const properties = node["properties"];
    expect(typeof properties, `${path}: object lists properties`).toBe("object");
    expect(node["additionalProperties"], `${path}: additionalProperties is false`).toBe(false);
    const required = node["required"];
    expect(Array.isArray(required), `${path}: all keys required`).toBe(true);
    const keys = Object.keys(properties as Record<string, unknown>).sort();
    expect([...(required as string[])].sort(), `${path}: required covers every key`).toEqual(keys);
  }

  for (const child of childNodes(node)) {
    assertStrictSubset(child, `${path} > …`, seen, depth + 1);
  }
  seen.delete(node);
}

describe("EVIDENCE_BRIEF_JSON_SCHEMA strict subset", () => {
  it("is a root object with additionalProperties:false and full required", () => {
    const root = EVIDENCE_BRIEF_JSON_SCHEMA as unknown as SchemaNode;
    expect(root["type"]).toBe("object");
    expect(root["additionalProperties"]).toBe(false);
    expect(root["required"]).toContain("entries");
  });

  it("holds the strict-subset rules everywhere: closed objects, no combinators, depth <= 10", () => {
    assertStrictSubset(
      EVIDENCE_BRIEF_JSON_SCHEMA as unknown as SchemaNode,
      "EvidenceBrief",
      new Set(),
      1,
    );
  });

  it("covers every EvidenceBrief category and flag", () => {
    const root = EVIDENCE_BRIEF_JSON_SCHEMA as unknown as SchemaNode;
    const properties = root["properties"] as Record<string, SchemaNode>;
    const entries = properties["entries"] as SchemaNode;
    const entry = entries["items"] as SchemaNode;
    const entryProps = entry["properties"] as Record<string, SchemaNode>;
    expect((entryProps["category"] as SchemaNode)["enum"]).toEqual([
      "decision",
      "action_item",
      "unresolved_question",
      "owner_review",
      "source_conflict",
    ]);
    const flags = ((entryProps["flags"] as SchemaNode)["items"] as SchemaNode)["enum"];
    expect(flags).toEqual([
      "missing_source",
      "citation_not_found",
      "conflicting_sources",
      "commitment_language",
      "request_not_accepted",
      "region_spotcheck_failed",
      "pressure",
      "instruction_in_evidence",
    ]);
  });
});
