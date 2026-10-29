import type { ParameterValue, ReportParameter } from "../../types";

export interface ParameterFormProps {
  parameters: ReportParameter[];
  values: Record<string, ParameterValue>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (id: string, value: ParameterValue) => void;
}
export function ParameterForm({
  parameters,
  values,
  errors,
  disabled,
  onChange,
}: ParameterFormProps) {
  return (
    <fieldset disabled={disabled} className="parameter-grid">
      <legend className="sr-only">Report parameters</legend>
      {parameters.map((parameter) => {
        const id = `parameter-${parameter.id}`;
        const errorId = `error-${parameter.id}`;
        const hintId = `hint-${parameter.id}`;
        const describedBy =
          [
            errors[parameter.id] ? errorId : "",
            parameter.kind === "multi-select" ? hintId : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined;
        const label = parameter.label + (parameter.required ? " *" : "");
        const common = {
          id,
          "aria-label": label,
          "aria-invalid": !!errors[parameter.id],
          "aria-describedby": describedBy,
          "aria-required": parameter.required,
        };
        return (
          <div
            key={parameter.id}
            className={`parameter-field ${parameter.kind === "multi-select" ? "full" : ""}`}
          >
            <label htmlFor={id}>{label}</label>
            {parameter.kind === "select" ||
            parameter.kind === "multi-select" ? (
              <select
                {...common}
                multiple={parameter.kind === "multi-select"}
                value={
                  values[parameter.id] ??
                  (parameter.kind === "multi-select" ? [] : "")
                }
                onChange={(event) =>
                  onChange(
                    parameter.id,
                    parameter.kind === "multi-select"
                      ? Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        )
                      : event.target.value,
                  )
                }
              >
                {parameter.kind === "select" && (
                  <option value="">
                    Select {parameter.label.toLowerCase()}
                  </option>
                )}
                {parameter.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={parameter.kind}
                value={String(values[parameter.id] ?? "")}
                placeholder={parameter.required ? "Required" : "All (optional)"}
                onChange={(event) => onChange(parameter.id, event.target.value)}
              />
            )}
            {parameter.kind === "multi-select" && (
              <span id={hintId} className="small muted">
                Use Ctrl / ⌘ to select multiple branches; leave empty for all.
              </span>
            )}
            {errors[parameter.id] && (
              <span id={errorId} className="field-error">
                {errors[parameter.id]}
              </span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
