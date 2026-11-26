import { useId, type ReactNode } from "react";

/**
 * The building blocks of Settings. Every section is a title, then groups of rows; every row is a label (with
 * an optional one-line description) on the left and its control on the right, separated by hairlines.
 * Using these everywhere keeps labels, controls and spacing aligned across the whole screen.
 */
export function SettingsSection({ id, title, description, children }: {
  id: string; title: string; description?: string; children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${id}`}>
      <header className="settings-section-head">
        <h2 id={`settings-${id}`}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function SettingsGroup({ title, description, children, actions }: {
  title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <header className="settings-group-head">
          <div>
            {title && <h3 id={id}>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="settings-rows">{children}</div>
    </section>
  );
}

/** One setting. Pass `htmlFor` when the control is a single input, so the label names it. */
export function SettingRow({ label, description, htmlFor, children, stacked = false }: {
  label: string; description?: ReactNode; htmlFor?: string; children: ReactNode; stacked?: boolean;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className={`setting-row${stacked ? " stacked" : ""}`}>
      <div className="setting-text">
        <Label className="setting-label" {...(htmlFor ? { htmlFor } : {})}>{label}</Label>
        {description && <p className="setting-description">{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** A choice among two to four options, shown all at once: the settings screen's one choice control. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <label key={option.value} className={option.value === value ? "selected" : ""}>
          <input type="radio" name={name} value={option.value} checked={option.value === value}
            onChange={() => onChange(option.value)} />
          {option.icon}
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
