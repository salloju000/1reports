import {
  useEffect,
  useState,
  useRef,
  type ElementType,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Star,
  ArrowUpRight,
} from "lucide-react";
import type { CatalogMetadata, Preferences } from "../types";
import { navigate } from "../hooks/useHub";
const nav: [string, string, ElementType][] = [
  ["overview", "Overview", LayoutDashboard],
  ["reports", "All Reports", FileText],
  ["favorites", "Favorites", Star],
  ["recent", "Recent Reports", Clock3],
  ["categories", "Categories", FolderOpen],
  ["activity", "My Activity", ActivityIcon],
];

export function AppShell({
  children,
  metadata,
  title,
  page,
  favoritesCount,
  density,
}: {
  children: ReactNode;
  metadata: CatalogMetadata;
  title: string;
  page: string;
  favoritesCount: number;
  density: Preferences["density"];
}) {
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [globalSearch, setGlobalSearch] = useState(""),
    [menu, setMenu] = useState<"notifications" | "profile" | null>(null),
    [read, setRead] = useState(false);
  const route = { page };
  const user = metadata.user,
    notifications = metadata.notifications;
  const menuTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setMobile(false);
    setMenu(null);
    document.title = title + " · EFI Reporting Hub";
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

  function globalSubmit(event: FormEvent) {
    event.preventDefault();
    navigate("reports", { search: globalSearch });
  }
  return (
    <div className={`app ${collapsed ? "collapsed" : ""} ${density}`}>
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
          aria-label="EFI Reporting Hub overview"
          className="brand"
          href="#/overview"
        >
          <span className="brand-mark">
            e<span>fi</span>
            <i />
          </span>
          <span className="brand-copy">
            Reporting Hub<span>YOUR REPORTS. CONNECTED.</span>
          </span>
        </a>
        <div className="workspace-label">
          <span>WORKSPACE</span>
          <span className="workspace-dot" />
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <a
              key={id}
              aria-label={label}
              href={`#/${id}`}
              title={collapsed ? label : undefined}
              aria-current={route.page === id ? "page" : undefined}
              className={route.page === id ? "active" : ""}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "reports" && <small>{metadata.total}</small>}
              {id === "favorites" && <small>{favoritesCount}</small>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-card">
            <span className="prototype-icon">
              <ShieldCheck size={20} />
            </span>
            <strong>Built for your workflow</strong>
            <p>Every report. One place.</p>
            <span className="prototype-badge">FRONTEND PROTOTYPE</span>
          </div>
          <nav>
            <a
              aria-label="Help & Support"
              href="#/help"
              className={route.page === "help" ? "active" : ""}
            >
              <HelpCircle size={19} />
              <span>Help & Support</span>
              <ArrowUpRight size={13} />
            </a>
            <a
              aria-label="Settings"
              href="#/settings"
              className={route.page === "settings" ? "active" : ""}
            >
              <Settings size={19} />
              <span>Settings</span>
            </a>
          </nav>
          <button
            aria-label={`Open settings for ${user.name}`}
            className="sidebar-user"
            onClick={() => navigate("settings")}
          >
            <span className="avatar">{user.initials}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="workspace-sidebar"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <form className="global-search" onSubmit={globalSubmit}>
              <Search size={16} />
              <input
                aria-label="Search all reports"
                placeholder="Search reports, codes, keywords..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              <button aria-label="Submit global search" type="submit">
                <ArrowRight size={14} />
              </button>
            </form>
            <span className="demo-pill">
              <span />
              Demo workspace
            </span>
            <div className="popover-anchor">
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
                {!read && <i />}
              </button>
              {menu === "notifications" && (
                <div
                  className="popover"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <strong>Notifications</strong>
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
            </div>
            <div className="popover-anchor">
              <button
                className="avatar top-avatar"
                aria-label="Open profile menu"
                aria-expanded={menu === "profile"}
                onClick={() => setMenu(menu === "profile" ? null : "profile")}
              >
                {user.initials}
              </button>
              {menu === "profile" && (
                <div
                  className="popover"
                  role="dialog"
                  aria-label="Profile menu"
                >
                  <strong>{user.name}</strong>
                  <p>{user.role} · Mock profile</p>
                  <button
                    className="button"
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
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="workspace-notice">
            <span>
              <span className="notice-dot" />
              PROTOTYPE WORKSPACE
            </span>
            <p>
              Explore with confidence. All reports and activity use
              demonstration data.
            </p>
            <span className="notice-end">
              No live systems connected <ShieldCheck size={13} />
            </span>
          </div>
          {children}
          <footer>
            <span>
              EFI Reporting Hub <span> / </span> Frontend prototype
            </span>
            <span>
              <span className="notice-dot" />
              All data is for demonstration purposes
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
