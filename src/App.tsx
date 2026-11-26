import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { Catalog } from "./pages/Catalog";
import { CrystalReports } from "./pages/CrystalReports";
import { BatchReports, maxBatch } from "./pages/BatchReports";
import { ActivityPage } from "./pages/Activity";
import { Overview } from "./pages/Overview";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { DepartmentsPage } from "./pages/Departments";
import { ReportAccessPage } from "./pages/ReportAccess";
import { AppShell } from "./layouts/AppShell";
import { ErrorState, Empty, PageHeader } from "./components/Workspace";
import { CatalogSkeleton, ShellSkeleton } from "./components/Skeleton";
import { repository as defaultRepository } from "./services/emptyRepository";
import { createLiveRepository } from "./services/liveRepository";
import type { ReportRepository } from "./services/contracts";
import { preferencesPersistence } from "./services/storage";
import type { PreferencesPersistence } from "./services/preferences";
import { HubProvider } from "./services/HubContext";
import { navigate, useAsync, useRoute } from "./hooks/useHub";
import { Details } from "./components/Reports";
import { account } from "./services/account";
import type { Preferences, Report } from "./types";
import type { Organization } from "./services/organization";
import { useBlockingOperation } from "./services/operations";

export type SessionControls = {
  email: string;
  administrator: boolean;
  /** The person's name and department, from their directory profile. */
  fullName?: string;
  userName?: string;
  department?: { id: string; name: string } | null;
  /** Display preferences saved with the account, if the person has saved any. */
  preferences?: Preferences | null;
  /** The organisation's name and logo for the header; administrators change them in Settings. */
  organization?: Organization;
  onOrganizationChange?: (organization: Organization) => void;
  busy: boolean;
  error: string;
  signOut: () => void;
  onUnauthorized: () => void;
};

export function App({
  repository: suppliedRepository,
  persistence = preferencesPersistence,
  session,
}: {
  repository?: ReportRepository;
  persistence?: PreferencesPersistence;
  session?: SessionControls;
}) {
  const live = !suppliedRepository && !!session;
  const repository = useMemo(() => suppliedRepository ?? (live ? createLiveRepository() : defaultRepository),
    [suppliedRepository, live]);
  const route = useRoute();
  // A report being generated pauses the account controls that would close it (see services/operations).
  const running = useBlockingOperation();
  const [revision, setRevision] = useState(0);
  // A signed-in person's saved preferences follow them between browsers; otherwise this browser's.
  const [preferences, setPreferences] = useState<Preferences>(() =>
    session?.preferences ?? persistence.get(),
  );
  const [selected, setSelected] = useState<{ report: Report; run: boolean }>();
  const [detailError, setDetailError] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean }>();
  const lastDeepLink = useRef("");
  const metadata = useAsync(() => repository.getMetadata(), [repository, live ? revision : 0]);
  const fav = useAsync(() => repository.getFavorites(), [repository, revision]);
  const acts = useAsync(() => repository.getActivity(), [repository, revision]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const favoriteUpdates = useRef(new Set<string>());
  const [pendingFavorites, setPendingFavorites] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (fav.data) setFavorites(fav.data);
  }, [fav.data]);
  const titles: Record<string, string> = {
    overview: "Overview",
    reports: "Reports",
    favorites: "Favorites",
    activity: "Activity",
    settings: "Settings",
    departments: "Departments",
    users: "Users",
    access: "Report access",
  };
  const title = titles[route.page] ?? "Page not found";
  const change = () => setRevision((value) => value + 1);
  async function toggle(id: string) {
    if (favoriteUpdates.current.has(id)) return;
    favoriteUpdates.current.add(id);
    setPendingFavorites(new Set(favoriteUpdates.current));
    try {
      const added = await repository.toggleFavorite(id);
      setFavorites(previous => added ? [...new Set([...previous, id])] : previous.filter(item => item !== id));
      setToast({ text: added ? "Report added to favorites" : "Report removed from favorites" });
      change();
    } catch {
      setToast({ text: "Unable to update favorites. Please try again.", error: true });
    } finally {
      favoriteUpdates.current.delete(id);
      setPendingFavorites(new Set(favoriteUpdates.current));
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
  /** Applies preferences at once, keeps them in this browser, and saves them to the account when signed in. */
  async function savePreferences(next: Preferences) {
    setPreferences(next);
    persistence.set(next);
    change();
    if (session) await account.savePreferences(next);
  }
  // Retired or renamed screens: keep old links and bookmarks working.
  useEffect(() => {
    if (route.page === "people") navigate("users", Object.fromEntries(route.params), true);
    else if (["categories", "recent", "help"].includes(route.page)) navigate("overview", {}, true);
  }, [route.page]);
  const deepLink = route.params.get("report");
  const catalogPage = route.page === "reports" || route.page === "favorites";
  const liveDetail = live && catalogPage && !!deepLink;
  // Several reports opened together: #/reports?batch=id1,id2 (see BatchReports).
  const batchIds = live && catalogPage
    ? [...new Set((route.params.get("batch") ?? "").split(",").filter(Boolean))].slice(0, maxBatch) : [];
  const leaveBatch = (keep?: string[]) => {
    const params = new URLSearchParams(route.params);
    if (keep?.length) params.set("batch", keep.join(","));
    else params.delete("batch");
    navigate(route.page, Object.fromEntries(params), !!keep?.length);
  };
  useEffect(() => {
    if (live) return;
    if (!deepLink) {
      lastDeepLink.current = "";
      return;
    }
    const key = `${route.page}:${deepLink}`;
    if (lastDeepLink.current === key) return;
    lastDeepLink.current = key;
    void open(deepLink, false, crypto.randomUUID());
  }, [deepLink, route.page, repository, live]);
  useEffect(() => {
    if (!toast || toast.error) return;
    const timeout = setTimeout(() => setToast(undefined), 5000);
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
    if (live) {
      const filters = catalogPage ? Object.fromEntries(route.params) : {};
      navigate(catalogPage ? route.page : "reports", { ...filters, report: id });
      return;
    }
    void open(id, run);
  };
  const previousMetadata = useRef(metadata.data);
  if (metadata.data) previousMetadata.current = metadata.data;
  const shellMetadata = metadata.data ?? (live && metadata.loading ? previousMetadata.current : undefined) ?? (live ? {
    total: 0, categories: [], departments: [], reportTypes: [], user: null, notifications: [],
  } : undefined);
  return (
    <HubProvider
      repository={repository}
      metadata={shellMetadata}
      persistence={persistence}
      pendingFavorites={pendingFavorites}
      audience={session && { administrator: session.administrator, department: session.department?.name ?? null }}
    >
      {metadata.error && !live ? (
        <ErrorState text={metadata.error} retry={metadata.retry} />
      ) : !shellMetadata ? (
        <ShellSkeleton />
      ) : (
        <AppShell
          metadata={shellMetadata}
          page={route.page}
          title={title}
          search={route.params.get("search") ?? ""}
          density={preferences.density}
          administrator={!!session?.administrator}
          organization={session?.organization}
          accountControls={session && (
            <div className="hub-session" aria-busy={session.busy}>
              <a className={`session-identity${running ? " locked" : ""}`} href="#/settings" title={session.email}
                aria-disabled={running ? true : undefined} onClick={event => { if (running) event.preventDefault(); }}>
                <strong>{session.fullName || session.email}</strong>
                <small>{session.administrator ? "Administrator" : session.department?.name ?? "No department"}</small>
              </a>
              <button className="button" disabled={session.busy || !!running} onClick={session.signOut}
                title={running ? "Available when the report is ready" : undefined}>
                {session.busy && <span className="spinner" aria-hidden="true" />}
                {session.busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        >
          {session?.error && <p className="error-banner" role="alert">{session.error}</p>}
          {(persistence.getWarning() || detailError || (fav.error && !metadata.error)) && (
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
          ) : batchIds.length && !deepLink ? (
            <BatchReports ids={batchIds} onClose={() => leaveBatch()} onActivity={change}
              onRemove={id => leaveBatch(batchIds.filter(other => other !== id))} />
          ) : liveDetail && deepLink ? (
            <CrystalReports reportId={deepLink} returnLabel={route.page === "favorites" ? "Back to favorites" : "Back to reports"} onClose={() => {
              const params = new URLSearchParams(route.params);
              params.delete("report");
              navigate(route.page, Object.fromEntries(params));
            }} onActivity={change} />
          ) : live && metadata.error && catalogPage ? (
            <ErrorState text="The report workspace is unavailable." retry={change} />
          ) : live && !metadata.data && metadata.loading && !previousMetadata.current &&
              catalogPage ? (
            <><PageHeader title={title} /><CatalogSkeleton /></>
          ) : route.page === "reports" || route.page === "favorites" ? (
            <Catalog
              key={route.page}
              page={route.page}
              query={route.query}
              favorites={favorites}
              revision={live ? revision : 0}
              live={live}
              preferences={preferences}
              onPreferences={next => void savePreferences(next).catch(() =>
                setToast({ text: "Your view was kept in this browser but couldn't be saved to your account.", error: true }))}
              onOpen={onOpen}
              onToggle={(id) => void toggle(id)}
            />
          ) : ["categories", "recent", "help", "people"].includes(route.page) ? (
            null
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
              user={shellMetadata.user}
              session={session}
              preferences={preferences}
              onChange={savePreferences}
              params={route.params}
            />
          ) : route.page === "departments" && session?.administrator ? (
            <DepartmentsPage />
          ) : route.page === "users" && session?.administrator ? (
            <UsersPage params={route.params} currentEmail={session.email} />
          ) : route.page === "access" && session?.administrator ? (
            <ReportAccessPage params={route.params} />
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
        <div className={`toast ${toast.error ? "toast-error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.error ? <CircleAlert size={17} /> : <Check size={17} />}
          {toast.text}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </HubProvider>
  );
}
