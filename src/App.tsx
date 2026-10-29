import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Catalog } from "./pages/Catalog";
import { ActivityPage } from "./pages/Activity";
import { Overview } from "./pages/Overview";
import { RecentPage } from "./pages/Recent";
import { SettingsPage } from "./pages/Settings";
import { HelpPage } from "./pages/Help";
import { AppShell } from "./layouts/AppShell";
import {
  PageHeading,
  Loading,
  ErrorState,
  Empty,
  CategoryCards,
} from "./components/Workspace";
import { repository as defaultRepository } from "./services/repository";
import type { ReportRepository } from "./services/contracts";
import { preferencesPersistence } from "./services/storage";
import type { PreferencesPersistence } from "./services/preferences";
import { HubProvider } from "./services/HubContext";
import { navigate, useAsync, useRoute } from "./hooks/useHub";
import { Details } from "./components/Reports";
import type { Preferences, Report } from "./types";

export function App({
  repository = defaultRepository,
  persistence = preferencesPersistence,
}: {
  repository?: ReportRepository;
  persistence?: PreferencesPersistence;
}) {
  const route = useRoute();
  const [revision, setRevision] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(() =>
    persistence.get(),
  );
  const [selected, setSelected] = useState<{ report: Report; run: boolean }>();
  const [detailError, setDetailError] = useState("");
  const [toast, setToast] = useState("");
  const lastDeepLink = useRef("");
  const metadata = useAsync(() => repository.getMetadata(), [repository]);
  const fav = useAsync(() => repository.getFavorites(), [repository]);
  const acts = useAsync(() => repository.getActivity(), [repository, revision]);
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    if (fav.data) setFavorites(fav.data);
  }, [fav.data]);
  const titles: Record<string, string> = {
    overview: "Overview",
    reports: "All Reports",
    favorites: "Favorites",
    recent: "Recent Reports",
    categories: "Categories",
    activity: "My Activity",
    settings: "Settings",
    help: "Help & Support",
  };
  const title = titles[route.page] ?? "Page not found";
  const change = () => setRevision((value) => value + 1);
  async function toggle(id: string) {
    try {
      const added = await repository.toggleFavorite(id);
      setFavorites(await repository.getFavorites());
      setToast(
        added ? "Report added to favorites" : "Report removed from favorites",
      );
      change();
    } catch {
      setToast("Unable to update favorites. Please try again.");
    }
  }
  async function open(
    id: string,
    run = false,
    interactionId = crypto.randomUUID(),
  ) {
    setDetailError("");
    try {
      const report = await repository.getReport(id);
      if (!report) {
        setDetailError(
          "This report could not be found. Return to the catalog and try another report.",
        );
        return;
      }
      setSelected({ report, run });
      await repository.recordActivity(id, "viewed", interactionId);
      change();
    } catch {
      setDetailError("Unable to open this report. Please try again.");
    }
  }
  function savePreferences(next: Preferences) {
    setPreferences(next);
    persistence.set(next);
    change();
  }
  const deepLink = route.params.get("report");
  useEffect(() => {
    if (!deepLink) {
      lastDeepLink.current = "";
      return;
    }
    const key = `${route.page}:${deepLink}`;
    if (lastDeepLink.current === key) return;
    lastDeepLink.current = key;
    void open(deepLink, false, crypto.randomUUID());
  }, [deepLink, route.page, repository]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);
  function closeDetails() {
    setSelected(undefined);
    if (route.params.has("report")) {
      const params = new URLSearchParams(route.params);
      params.delete("report");
      navigate(route.page, Object.fromEntries(params));
    }
  }
  const onOpen = (id: string, run = false) => {
    void open(id, run);
  };
  return (
    <HubProvider
      repository={repository}
      metadata={metadata.data}
      persistence={persistence}
    >
      {metadata.error ? (
        <ErrorState text={metadata.error} retry={metadata.retry} />
      ) : !metadata.data ? (
        <Loading />
      ) : (
        <AppShell
          metadata={metadata.data}
          page={route.page}
          title={title}
          favoritesCount={favorites.length}
          density={preferences.density}
        >
          {(persistence.getWarning() || detailError || fav.error) && (
            <div className="error-banner" role="alert">
              {detailError || fav.error || persistence.getWarning()}
              {detailError && (
                <button
                  className="text-button"
                  onClick={() => setDetailError("")}
                >
                  Dismiss
                </button>
              )}
              {fav.error && (
                <button className="text-button" onClick={fav.retry}>
                  Retry favorites
                </button>
              )}
            </div>
          )}
          {route.page === "overview" ? (
            <Overview
              revision={revision}
              favorites={favorites}
              onOpen={onOpen}
              onToggle={(id) => void toggle(id)}
            />
          ) : route.page === "reports" || route.page === "favorites" ? (
            <Catalog
              key={route.page}
              page={route.page}
              query={route.query}
              favorites={favorites}
              revision={revision}
              preferences={preferences}
              onPreferences={savePreferences}
              onOpen={onOpen}
              onToggle={(id) => void toggle(id)}
            />
          ) : route.page === "categories" ? (
            <>
              <PageHeading
                title="Categories"
                description="Explore reports organized around the way your business works."
              />
              <CategoryCards detailed />
            </>
          ) : route.page === "recent" ? (
            <RecentPage revision={revision} onOpen={onOpen} />
          ) : route.page === "activity" ? (
            <ActivityPage
              activity={acts.data ?? []}
              error={acts.error}
              loading={acts.loading}
              retry={acts.retry}
              onOpen={onOpen}
            />
          ) : route.page === "settings" ? (
            <SettingsPage
              user={metadata.data.user}
              preferences={preferences}
              onChange={savePreferences}
            />
          ) : route.page === "help" ? (
            <HelpPage />
          ) : (
            <Empty
              title="Page not found"
              text="Use the sidebar to return to your reporting workspace."
            />
          )}
        </AppShell>
      )}
      {selected && (
        <Details
          key={selected.report.id}
          report={selected.report}
          focusParameters={selected.run}
          favorites={favorites}
          onToggle={(id) => void toggle(id)}
          onClose={closeDetails}
          onChange={change}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </HubProvider>
  );
}
