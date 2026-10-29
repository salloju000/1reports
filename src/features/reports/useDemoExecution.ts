import { useRef, useState } from "react";
import type { DemoExecutionService } from "../../services/execution";
import { validateParameters } from "../../services/execution";
import type {
  DemoPreview,
  ExecutionState,
  ParameterValue,
  Report,
} from "../../types";

export function useDemoExecution(
  report: Report,
  service: DemoExecutionService,
  onChange: () => void,
) {
  const [state, setState] = useState<ExecutionState>("idle");
  const [values, setValues] = useState<Record<string, ParameterValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<DemoPreview>();
  const pending = useRef(false);
  const currentState = useRef<ExecutionState>("idle");
  async function advance(action: "run" | "complete" | "reset") {
    if (pending.current) return;
    if (action === "run") {
      if (currentState.current !== "idle") return;
      const nextErrors = validateParameters(report, values);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) return false;
    }
    if (action === "complete" && currentState.current !== "processing") return;
    pending.current = true;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const sample =
        action === "complete" ? await service.getPreview(report.id) : undefined;
      const next = await service.executeDemo(
        report.id,
        action,
        currentState.current,
      );
      currentState.current = next;
      setState(next);
      setPreview(sample);
      if (action === "reset") setErrors({});
      onChange();
      return true;
    } catch {
      setFailure("The demonstration could not be updated. Please try again.");
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function changeValue(id: string, value: ParameterValue) {
    setValues((current) => ({ ...current, [id]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  return {
    state,
    values,
    errors,
    busy,
    failure,
    notice,
    preview,
    advance,
    changeValue,
    setNotice,
  };
}
