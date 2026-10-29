import type { Preferences } from "../types";
export interface PreferencesPersistence {
  get(): Preferences;
  set(preferences: Preferences): void;
  getWarning(): string;
}
