import type {
  DemoPreview,
  ExecutionState,
  ParameterValue,
  Report,
} from "../types";

export interface DemoExecutionService {
  executeDemo(
    id: string,
    action: "run" | "complete" | "reset",
    state: ExecutionState,
  ): Promise<ExecutionState>;
  getPreview(id: string): Promise<DemoPreview>;
}
export function validateParameters(
  report: Report,
  values: Record<string, ParameterValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const p of report.parameters) {
    const value = values[p.id];
    const empty =
      value === undefined ||
      (Array.isArray(value) ? value.length === 0 : !value.trim());
    if (empty) {
      if (p.required) errors[p.id] = `${p.label} is required.`;
      continue;
    }
    if (p.kind === "multi-select") {
      if (!Array.isArray(value) || value.some((v) => !p.options?.includes(v)))
        errors[p.id] = "Choose valid options.";
    } else if (typeof value !== "string")
      errors[p.id] = "Enter a single value.";
    else if (p.kind === "select" && !p.options?.includes(value))
      errors[p.id] = "Choose a valid option.";
    else if (p.kind === "date") {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value ||
        value.startsWith("0000")
      )
        errors[p.id] = "Enter a valid date.";
    }
  }
  if (
    !errors.startDate &&
    !errors.endDate &&
    values.startDate &&
    values.endDate &&
    String(values.startDate) > String(values.endDate)
  )
    errors.endDate = "End date must be on or after start date.";
  return errors;
}
export function executionTransition(
  state: ExecutionState,
  action: "run" | "complete" | "reset",
): ExecutionState {
  return action === "reset"
    ? "idle"
    : action === "run" && state === "idle"
      ? "processing"
      : action === "complete" && state === "processing"
        ? "success"
        : state;
}
