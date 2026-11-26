import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The administration dialogs' shell, built on the native dialog element: focus moves into it and is
 * trapped while open, Escape and the backdrop close it, and focus returns to the opener on close.
 */
export function Modal({ title, onClose, children, className = "" }: {
  title: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal?.();
    element?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => {
      element?.close?.();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className={`people-dialog ${className}`.trim()} aria-labelledby="people-dialog-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === dialog.current) onClose(); }}>
      <header className="people-dialog-head">
        <h2 id="people-dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </header>
      {children}
    </dialog>
  );
}

/** A labelled form control with its hint, or its error once the server has rejected the value. */
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="people-field">
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}
