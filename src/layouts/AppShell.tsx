import { useEffect, useState, useRef, type ElementType, type ReactNode } from "react";
import {
  Activity as ActivityIcon,
  Bell,
  Building2,
  ChevronDown,
  FileText,
  KeyRound,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Star,
  Users,
} from "lucide-react";
import type { CatalogMetadata, Preferences } from "../types";
import { navigate } from "../hooks/useHub";
import { Brand, productName } from "../components/Brand";
import { ReportSearch } from "../components/ReportSearch";
import { logoUrl, type Organization } from "../services/organization";
import { useBlockingOperation } from "../services/operations";
// One entry per destination. Categories are not a destination of their own: they are a filter on Reports,
// reached from the Overview. Counts live on the page headings, not here.
type Destination = [string, string, ElementType];
const nav: Destination[] = [
  ["overview", "Overview", LayoutDashboard],
  ["reports", "Reports", FileText],
  ["favorites", "Favorites", Star],
  ["activity", "Activity", ActivityIcon],
];
// Shown to administrators only; the server refuses these APIs to everyone else regardless.
const administration: Destination[] = [
  ["departments", "Departments", Building2],
  ["users", "Users", Users],
  ["access", "Report access", KeyRound],
];

export function AppShell({
  children,
  metadata,
  title,
  page,
  search,
  density,
  administrator = false,
  organization,
  accountControls,
}: {
  children: ReactNode;
  metadata: CatalogMetadata;
  /** The page's name, for the browser tab only: the page itself shows its heading. */
  title: string;
  page: string;
  /** The search term in the URL, shown in the shell's search box on list pages. */
  search: string;
  density: Preferences["density"];
  /** Administrators also see the Administration section: Departments, Users and Report access. */
  administrator?: boolean;
  /** The organisation's name and logo, shown at the start of the header when an administrator has set them. */
  organization?: Organization;
  accountControls?: ReactNode;
}) {
  const organizationLogo = organization && logoUrl(organization);
  const showOrganization = !!(organization?.name || organizationLogo);
  const [collapsed, setCollapsed] = useState(true),
    [mobile, setMobile] = useState(false),
    [menu, setMenu] = useState<"notifications" | "profile" | null>(null),
    [read, setRead] = useState(false);
  const route = { page };
  const compact = collapsed;
  const user = metadata.user,
    notifications = metadata.notifications;
  const menuTrigger = useRef<HTMLElement | null>(null);
  // While a report is generating, links that would leave it are paused (not hidden): they say why, and
  // come back the moment the report is ready, fails or is cancelled.
  const running = useBlockingOperation();
  const paused = running ? "Available when the report is ready" : undefined;
  const hold = (event: { preventDefault: () => void }) => { if (running) event.preventDefault(); };
  const link = ([id, label, Icon]: Destination) => (
    <a
      key={id}
      aria-label={label}
      href={`#/${id}`}
      data-tooltip={running ? `${label} · ${paused}` : label}
      title={paused}
      aria-disabled={running ? true : undefined}
      onClick={hold}
      aria-current={route.page === id ? "page" : undefined}
      className={`${route.page === id ? "active" : ""}${running ? " locked" : ""}`}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
  // Rail tooltips are for finding a destination by pointing (or by keyboard focus). Pressing an item
  // hides its tooltip until the pointer leaves, so a click never leaves a label hanging beside the rail.
  useEffect(() => {
    const sidebar = document.getElementById("workspace-sidebar");
    if (!sidebar) return;
    const press = (event: PointerEvent) => {
      const item = (event.target as Element | null)?.closest<HTMLElement>("[data-tooltip]");
      if (!item) return;
      item.setAttribute("data-tooltip-hidden", "");
      item.addEventListener("pointerleave", () => item.removeAttribute("data-tooltip-hidden"), { once: true });
    };
    sidebar.addEventListener("pointerdown", press);
    return () => sidebar.removeEventListener("pointerdown", press);
  }, []);
  useEffect(() => {
    setMobile(false);
    setMenu(null);
    document.title = `${title} · ${productName}`;
  }, [page, title]);
  useEffect(() => {
    if (!menu) return;
    const trigger = document.activeElement as HTMLElement;
    menuTrigger.current = trigger;
    const panel = document.querySelector<HTMLElement>(".popover");
    panel?.querySelector<HTMLElement>("button")?.focus();
    const dismiss = (restore: boolean) => {
      setMenu(null);
      if (restore) trigger.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(true);
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel?.contains(event.target) &&
        !trigger.contains(event.target)
      )
        dismiss(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel?.contains(event.target) &&
        !trigger.contains(event.target)
      )
        dismiss(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("focusin", focusOutside);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("focusin", focusOutside);
      if (panel?.contains(document.activeElement)) trigger.focus();
    };
  }, [menu]);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement;
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const shell = document.querySelector<HTMLElement>(".main-shell");
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>("a, button:not([disabled])") ??
          [],
      ).filter((el) => el.getClientRects().length > 0);
    shell?.setAttribute("inert", "");
    focusable()[0]?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
      if (e.key === "Tab") {
        const list = focusable(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    const mobileViewport = window.matchMedia?.("(max-width: 760px)");
    const resized = () => {
      if (mobileViewport && !mobileViewport.matches) setMobile(false);
    };
    mobileViewport?.addEventListener("change", resized);
    return () => {
      window.removeEventListener("keydown", close);
      mobileViewport?.removeEventListener("change", resized);
      shell?.removeAttribute("inert");
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [mobile]);

  return (
    <div className={`app ${compact ? "collapsed" : ""} ${density}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      {mobile && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${mobile ? "mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <a
          aria-label={`${productName} overview`}
          className={`brand${running ? " locked" : ""}`}
          aria-disabled={running ? true : undefined}
          title={paused}
          onClick={hold}
          href="#/overview"
        >
          <Brand />
        </a>
        <nav aria-label="Workspace">
          {nav.map(link)}
        </nav>
        {administrator && (
          <nav className="sidebar-section" aria-labelledby="sidebar-administration">
            <h2 id="sidebar-administration">Administration</h2>
            {administration.map(link)}
          </nav>
        )}
        <div className="sidebar-bottom">
          <nav aria-label="Account">
            {link(["settings", "Settings", Settings])}
          </nav>
          {user && (
            <button
              aria-label={`Open settings for ${user.name}`}
              className="sidebar-user"
              disabled={!!running}
              title={paused}
              onClick={() => navigate("settings")}
            >
              <span className="avatar">{user.initials}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </span>
              <ChevronDown size={15} />
            </button>
          )}
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-start">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-sidebar"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            {showOrganization && (
              <a className={`organization-brand${organization?.name ? "" : " logo-only"}${running ? " locked" : ""}`}
                href="#/overview" aria-disabled={running ? true : undefined} onClick={hold}
                aria-label={organization?.name ? `${organization.name} overview` : "Overview"} title={organization?.name ?? undefined}>
                {organizationLogo && <img className="organization-logo" src={organizationLogo} alt="" />}
                {organization?.name && <span className="organization-name">{organization.name}</span>}
              </a>
            )}
            <ReportSearch page={page} term={search} paused={!!running} />
          </div>
          <div className="topbar-right">
            {notifications.length > 0 && <div className="popover-anchor">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={menu === "notifications"}
                onClick={() => {
                  setMenu(menu === "notifications" ? null : "notifications");
                  setRead(true);
                }}
              >
                <Bell size={19} />
                {!read && notifications.length > 0 && <i />}
              </button>
              {menu === "notifications" && (
                <div
                  className="popover"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <strong>Notifications</strong>
                  {notifications.length === 0 && <p>No notifications.</p>}
                  {notifications.map((n) => (
                    <div key={n.id}>
                      <h4>{n.title}</h4>
                      <p>{n.description}</p>
                    </div>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => {
                      setMenu(null);
                      menuTrigger.current?.focus();
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>}
            {user && (
              <div className="popover-anchor">
                <button
                  className="profile-control"
                  aria-label="Open profile menu"
                  aria-expanded={menu === "profile"}
                  onClick={() => setMenu(menu === "profile" ? null : "profile")}
                >
                  <span className="avatar top-avatar">{user.initials}</span>
                  <span className="profile-name">{user.name.split(" ")[0]}</span>
                  <ChevronDown size={12} />
                </button>
                {menu === "profile" && (
                  <div
                    className="popover"
                    role="dialog"
                    aria-label="Profile menu"
                  >
                    <strong>{user.name}</strong>
                    <p>{user.role}</p>
                    <button
                      className="button"
                      disabled={!!running}
                      title={paused}
                      onClick={() => {
                        setMenu(null);
                        navigate("settings");
                      }}
                    >
                      Profile & preferences
                    </button>
                  </div>
                )}
              </div>
            )}
            {accountControls}
          </div>
        </header>
        {/* The header stays put: only this region scrolls, so its scrollbar starts below the header. */}
        <div className="main-scroll">
          <main id="main-content" tabIndex={-1} data-page={page}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
