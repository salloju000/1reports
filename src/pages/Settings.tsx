import { Check } from "lucide-react";
import type { MockUser, Preferences } from "../types";
import { PageHeading } from "../components/Workspace";
export function SettingsPage({
  user,
  preferences,
  onChange,
}: {
  user: MockUser;
  preferences: Preferences;
  onChange: (p: Preferences) => void;
}) {
  return (
    <>
      <PageHeading
        title="Settings"
        description="Make this workspace feel like yours. Preferences are stored in this browser."
      />
      <div className="settings-layout">
        <section className="panel settings-panel">
          <h2>Profile</h2>
          <div className="profile-summary">
            <span className="avatar">AM</span>
            <div>
              <strong>{user.name}</strong>
              <p>{user.role}</p>
            </div>
            <span className="tag blue">Mock user</span>
          </div>
          <dl className="metadata">
            <div>
              <dt>Company</dt>
              <dd>{user.company}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
          <p className="muted small">
            Profile editing and enterprise sign-in will be available in a future
            integration phase.
          </p>
        </section>
        <section className="panel settings-panel">
          <h2>Display preferences</h2>
          <label>
            Default report view
            <select
              value={preferences.view}
              onChange={(e) =>
                onChange({
                  ...preferences,
                  view: e.target.value as Preferences["view"],
                })
              }
            >
              <option value="list">List view</option>
              <option value="grid">Grid view</option>
            </select>
          </label>
          <label>
            Information density
            <select
              value={preferences.density}
              onChange={(e) =>
                onChange({
                  ...preferences,
                  density: e.target.value as Preferences["density"],
                })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <p className="saved-hint">
            <Check size={14} />
            Changes save automatically in this browser.
          </p>
          <p className="muted small">Appearance: Light theme</p>
        </section>
      </div>
    </>
  );
}
