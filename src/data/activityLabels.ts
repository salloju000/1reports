import type { Activity } from "../types";
export const eventLabels: Record<Activity["kind"], string> = {
  viewed: "Report viewed",
  "favorite-added": "Added to favorites",
  "favorite-removed": "Removed from favorites",
  "demo-started": "Demo execution started",
  "demo-completed": "Demo execution completed",
};
