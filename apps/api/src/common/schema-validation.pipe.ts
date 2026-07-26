import { BadRequestException, type PipeTransform } from "@nestjs/common";

type ValidationIssue = {
  code?: string;
  keys?: readonly string[];
  message: string;
  path: readonly PropertyKey[];
};

type ValidationResult<T> =
  { success: true; data: T } | { success: false; error: { issues: readonly ValidationIssue[] } };

export type RuntimeSchema<T> = {
  safeParse(value: unknown): ValidationResult<T>;
};

function fieldErrors(issues: readonly ValidationIssue[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys" && issue.keys) {
      for (const key of issue.keys) {
        errors[key] = [...(errors[key] ?? []), "Unknown field"];
      }
      continue;
    }

    const field = issue.path.map(String).join(".") || "_request";
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

export class SchemaValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: RuntimeSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      message: "Request validation failed",
      errors: fieldErrors(result.error.issues),
    });
  }
}
