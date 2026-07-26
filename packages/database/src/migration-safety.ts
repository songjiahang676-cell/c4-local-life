export type MigrationSafetyRule =
  | "ADD_REQUIRED_COLUMN"
  | "DELETE_DATA"
  | "DROP_COLUMN"
  | "DROP_CONSTRAINT"
  | "DROP_INDEX"
  | "DROP_SCHEMA"
  | "DROP_TABLE"
  | "DROP_TYPE"
  | "RENAME_OBJECT"
  | "SET_NOT_NULL"
  | "TRUNCATE_DATA"
  | "UPDATE_DATA";

export type MigrationSafetyFinding = {
  approved: boolean;
  line: number;
  rule: MigrationSafetyRule;
  statement: string;
};

type SafetyPattern = {
  rule: MigrationSafetyRule;
  pattern: RegExp;
};

const safetyPatterns: readonly SafetyPattern[] = [
  { rule: "DROP_TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { rule: "DROP_COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { rule: "DROP_TYPE", pattern: /\bDROP\s+TYPE\b/i },
  { rule: "DROP_SCHEMA", pattern: /\bDROP\s+SCHEMA\b/i },
  { rule: "DROP_INDEX", pattern: /\bDROP\s+INDEX\b/i },
  { rule: "DROP_CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { rule: "TRUNCATE_DATA", pattern: /^\s*TRUNCATE\b/i },
  { rule: "DELETE_DATA", pattern: /^\s*DELETE\s+FROM\b/i },
  { rule: "UPDATE_DATA", pattern: /^\s*UPDATE\s+/i },
  { rule: "RENAME_OBJECT", pattern: /\bRENAME\s+(?:TO|COLUMN)\b/i },
  { rule: "SET_NOT_NULL", pattern: /\bALTER\s+COLUMN\b[\s\S]*\bSET\s+NOT\s+NULL\b/i },
  {
    rule: "ADD_REQUIRED_COLUMN",
    pattern: /\bADD\s+(?!CONSTRAINT\b)(?:COLUMN\s+)?[\s\S]*\bNOT\s+NULL\b/i,
  },
] as const;

function maskMatch(match: string): string {
  return match.replace(/[^\r\n]/g, " ");
}

function maskNonExecutableSql(source: string): string {
  return source
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, maskMatch)
    .replace(/\/\*[\s\S]*?\*\//g, maskMatch)
    .replace(/'(?:''|[^'])*'/g, maskMatch)
    .replace(/--[^\r\n]*/g, maskMatch);
}

function approvedRules(source: string): Set<MigrationSafetyRule> {
  const approvals = new Set<MigrationSafetyRule>();
  const directive =
    /--\s*migration-safety:\s*allow\s+([A-Z_]+)\s+reason="([^"\r\n]+)"\s+rollback="([^"\r\n]+)"/g;
  for (const match of source.matchAll(directive)) {
    const rule = match[1] as MigrationSafetyRule;
    if (safetyPatterns.some((candidate) => candidate.rule === rule)) approvals.add(rule);
  }
  return approvals;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

export function analyzeMigrationSql(source: string): MigrationSafetyFinding[] {
  const masked = maskNonExecutableSql(source);
  const approvals = approvedRules(source);
  const findings: MigrationSafetyFinding[] = [];
  let statementStart = 0;

  for (const statement of masked.split(";")) {
    for (const { rule, pattern } of safetyPatterns) {
      const match = pattern.exec(statement);
      if (!match) continue;
      findings.push({
        approved: approvals.has(rule),
        line: lineAt(masked, statementStart + (match.index ?? 0)),
        rule,
        statement: statement.replace(/\s+/g, " ").trim().slice(0, 180),
      });
    }
    statementStart += statement.length + 1;
  }

  return findings;
}
