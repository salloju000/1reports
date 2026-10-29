import type { Activity, ActivityKind, Preferences } from "../types";
import type { PreferencesPersistence } from "./preferences";
type Stored = {
  version: 1;
  favorites: string[];
  activity: Activity[];
  preferences: Preferences;
};
const initial = (): Stored => ({
  version: 1,
  favorites: ["receivable-1", "sales-1", "inventory-1", "finance-2"],
  activity: [],
  preferences: { view: "list", density: "comfortable" },
});
export class LocalStore {
  data: Stored = initial();
  warning = "";
  constructor(private storage?: Storage) {
    try {
      const raw = storage?.getItem("efi-hub-v1");
      if (raw) {
        const p: unknown = JSON.parse(raw);
        if (!this.valid(p)) throw Error("Invalid stored preferences");
        this.data = p;
      }
    } catch {
      this.warning =
        "Saved browser data could not be read. Using session defaults.";
    }
  }
  private valid(p: unknown): p is Stored {
    if (typeof p !== "object" || p === null) return false;
    const d = p as Partial<Stored>;
    return (
      d.version === 1 &&
      Array.isArray(d.favorites) &&
      d.favorites.every((x) => typeof x === "string") &&
      Array.isArray(d.activity) &&
      d.activity.every(
        (a) =>
          a &&
          typeof a.id === "string" &&
          typeof a.reportId === "string" &&
          [
            "viewed",
            "favorite-added",
            "favorite-removed",
            "demo-started",
            "demo-completed",
          ].includes(a.kind) &&
          !Number.isNaN(Date.parse(a.at)) &&
          a.source === "local",
      ) &&
      !!d.preferences &&
      ["list", "grid"].includes(d.preferences.view) &&
      ["comfortable", "compact"].includes(d.preferences.density)
    );
  }
  save() {
    try {
      if (!this.storage) throw Error();
      this.storage.setItem("efi-hub-v1", JSON.stringify(this.data));
    } catch {
      this.warning =
        "Browser storage is unavailable. Changes will last for this session only.";
    }
  }
  toggle(id: string) {
    const exists = this.data.favorites.includes(id);
    this.data.favorites = exists
      ? this.data.favorites.filter((x) => x !== id)
      : [...this.data.favorites, id];
    this.record(id, exists ? "favorite-removed" : "favorite-added");
    return !exists;
  }
  record(reportId: string, kind: ActivityKind) {
    const event: Activity = {
      id: crypto.randomUUID(),
      reportId,
      kind,
      at: new Date().toISOString(),
      source: "local",
    };
    this.data.activity = [event, ...this.data.activity].slice(0, 500);
    this.save();
  }
}
let browserStorage: Storage | undefined;
try {
  browserStorage = window.localStorage;
} catch {
  /* private mode fallback */
}
export const localStore = new LocalStore(browserStorage);

export const preferencesPersistence: PreferencesPersistence = {
  get: () => ({ ...localStore.data.preferences }),
  set: (preferences) => {
    localStore.data.preferences = { ...preferences };
    localStore.save();
  },
  getWarning: () => localStore.warning,
};
