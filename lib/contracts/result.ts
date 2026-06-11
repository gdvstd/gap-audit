export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function fail<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
  errors: string[]
): value is T {
  if (!isString(value) || !(allowed as readonly string[]).includes(value)) {
    errors.push(
      `${fieldName} must be one of: ${allowed.join(", ")}; got ${JSON.stringify(value)}`
    );
    return false;
  }
  return true;
}

export function requireString(
  obj: Record<string, unknown>,
  field: string,
  errors: string[]
): boolean {
  if (!isString(obj[field]) || (obj[field] as string).length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

export function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  errors: string[]
): boolean {
  if (!isStringArray(obj[field])) {
    errors.push(`${field} must be an array of strings`);
    return false;
  }
  return true;
}

export function requireBoolean(
  obj: Record<string, unknown>,
  field: string,
  errors: string[]
): boolean {
  if (!isBoolean(obj[field])) {
    errors.push(`${field} must be a boolean`);
    return false;
  }
  return true;
}

export function requireArray(
  obj: Record<string, unknown>,
  field: string,
  errors: string[]
): boolean {
  if (!isArray(obj[field])) {
    errors.push(`${field} must be an array`);
    return false;
  }
  return true;
}
