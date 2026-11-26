import { sendJson } from "./api";
import type { Preferences } from "../types";

/** The signed-in person's own settings. The server applies these to their account only. */
export const account = {
  savePreferences: (preferences: Preferences) => sendJson<void>("account/preferences", "PUT", preferences),
  changePassword: (currentPassword: string, newPassword: string) =>
    sendJson<void>("account/password", "POST", { currentPassword, newPassword }),
};
