export function toFailureModeTag(failure_mode: string): string {
  return failure_mode
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function derivePatternName(
  _lens: string,
  failure_mode: string,
  task_type: string
): string {
  return `${toFailureModeTag(failure_mode)}:${task_type}`;
}
