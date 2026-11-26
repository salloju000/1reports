import { useEffect, useSyncExternalStore } from "react";

/**
 * Long-running operations in progress (a report being generated, a report file uploading), so the parts of
 * the app that would cut one short can step aside while it runs, and nothing else is restricted.
 *
 * - A "blocking" operation lives on one screen and is lost if that screen closes (a report run). While one
 *   runs, the controls that would leave the screen are disabled with a reason, the browser's Back/Forward
 *   asks before leaving, and closing or reloading the tab asks too.
 * - A non-blocking one only asks before the tab is closed or reloaded (an upload that is still sending).
 */
export type Operation = {
  id: number;
  /** What is running, in words: "Generating SRPL-WasteOutputNew". */
  label: string;
  blocking: boolean;
  /** The screen the operation belongs to: its page and open report, as read from the address. */
  screen: string;
};

let operations: Operation[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

/**
 * The screen an address shows: its page and, on report pages, the open report (or the set of reports opened
 * together). Other parameters don't count.
 */
export function screenOf(hash: string) {
  const [page, search = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(search);
  const report = params.get("report");
  const batch = params.get("batch");
  return `${page || "overview"}${report ? `:${report}` : batch ? ":batch" : ""}`;
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!operations.length) return;
  event.preventDefault();
  // Older browsers need a returnValue; the text itself is no longer shown.
  event.returnValue = "";
}

/** Registers an operation; call the returned function when it ends (success, failure or cancel). */
export function startOperation(label: string, blocking: boolean): () => void {
  const operation: Operation = { id: nextId++, label, blocking, screen: screenOf(window.location.hash) };
  operations = [...operations, operation];
  if (operations.length === 1) window.addEventListener("beforeunload", beforeUnload);
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    operations = operations.filter(item => item !== operation);
    if (!operations.length) window.removeEventListener("beforeunload", beforeUnload);
    emit();
  };
}

/** Registers an operation for as long as `active` is true (and the component is mounted). */
export function useOperation(active: boolean, label: string, blocking = true) {
  useEffect(() => {
    if (!active) return;
    return startOperation(label, blocking);
  }, [active, label, blocking]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => operations;

export function useOperations() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The operation that controls leaving the current screen should wait for, if any. */
export function useBlockingOperation(): Operation | undefined {
  return useOperations().find(operation => operation.blocking);
}

export function blockingOperation(): Operation | undefined {
  return operations.find(operation => operation.blocking);
}

/**
 * Whether moving to `hash` may go ahead. Moves within the operation's own screen always may; leaving it asks
 * first, because leaving cancels the operation. Used for Back/Forward and typed addresses, which can't be
 * disabled like a button.
 */
export function mayLeaveTo(hash: string): boolean {
  const operation = blockingOperation();
  if (!operation || screenOf(hash) === operation.screen) return true;
  return window.confirm(`${operation.label} is still in progress. Leave this page and cancel it?`);
}

/** For tests: forget every operation. */
export function resetOperations() {
  operations = [];
  window.removeEventListener("beforeunload", beforeUnload);
  emit();
}
