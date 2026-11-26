import type { CSSProperties, ReactNode } from "react";

/**
 * Loading placeholders shaped like the content they stand in for, so the page doesn't jump when it arrives.
 * Each skeleton is one polite status for assistive technology (its label), and purely visual otherwise.
 * They fade in after a short delay, so a fast response never flashes a placeholder.
 */
export function Skeleton({ width, height = 12, radius, className = "" }: {
  width?: number | string; height?: number | string; radius?: number | string; className?: string;
}) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span className={`skeleton ${className}`} style={style} />;
}

export function LoadingRegion({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`loading-region ${className}`} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="loading-region-body">{children}</div>
    </div>
  );
}

/** A thin indeterminate bar along the top of a surface whose content is being refreshed in place. */
export function RefreshBar({ active }: { active: boolean }) {
  return <span className={`refresh-bar${active ? " active" : ""}`} aria-hidden="true" />;
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);
// Varied widths read as text rather than as a grid of identical bars.
const widths = ["62%", "48%", "71%", "55%", "66%", "44%", "58%", "69%"];

/** The report table on Reports and Favorites. */
export function ReportTableSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-head"><Skeleton width={90} height={9} /><Skeleton width={60} height={9} /><span /><Skeleton width={46} height={9} /></div>
      {range(rows).map(index => (
        <div className="skeleton-table-row" key={index}>
          <div className="skeleton-identity">
            <Skeleton width={26} height={32} radius={4} />
            <div><Skeleton width={widths[index % widths.length]} height={13} /><Skeleton width={70} height={10} /></div>
          </div>
          <Skeleton width={96} height={11} />
          <Skeleton width={16} height={16} radius={4} />
          <div className="skeleton-actions"><Skeleton width={16} height={16} radius={4} /><Skeleton width={16} height={16} radius={4} /></div>
        </div>
      ))}
    </div>
  );
}

/** Short report lists (Overview). */
export function ReportRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-rows">
      {range(rows).map(index => (
        <div className="skeleton-row" key={index}>
          <Skeleton width={26} height={32} radius={4} />
          <div><Skeleton width={widths[(index + 2) % widths.length]} height={13} /><Skeleton width={140} height={10} /></div>
          <Skeleton width={14} height={14} radius={4} />
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton({ children }: { children: ReactNode }) {
  return <div className="skeleton-section"><Skeleton width={84} height={11} />{children}</div>;
}

export function CategoryGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-cards">
      {range(count).map(index => (
        <div className="skeleton-card" key={index}>
          <Skeleton width={32} height={32} radius={8} />
          <div><Skeleton width={widths[(index + 1) % widths.length]} height={13} /><Skeleton width={56} height={10} /></div>
        </div>
      ))}
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <LoadingRegion label="Loading overview…">
      <SectionSkeleton><ReportRowsSkeleton rows={2} /></SectionSkeleton>
      <SectionSkeleton><ReportRowsSkeleton rows={1} /></SectionSkeleton>
      <SectionSkeleton><CategoryGridSkeleton /></SectionSkeleton>
    </LoadingRegion>
  );
}

/** The Reports/Favorites toolbar and table, before the first results arrive. */
export function CatalogSkeleton() {
  return (
    <LoadingRegion label="Loading reports…">
      <ReportTableSkeleton />
    </LoadingRegion>
  );
}

/** People tables: avatar, name and username, email, role and status pills, actions. */
export function PeopleTableSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-head people"><Skeleton width={60} height={9} /><Skeleton width={50} height={9} /><Skeleton width={40} height={9} /><span /></div>
      {range(rows).map(index => (
        <div className="skeleton-table-row people" key={index}>
          <div className="skeleton-identity">
            {avatar && <Skeleton width={32} height={32} radius="50%" />}
            <div><Skeleton width={widths[(index + 3) % widths.length]} height={13} /><Skeleton width={80} height={10} /></div>
          </div>
          <Skeleton width={150} height={11} />
          <Skeleton width={64} height={20} radius={999} />
          <div className="skeleton-actions"><Skeleton width={16} height={16} radius={4} /><Skeleton width={76} height={28} radius={8} /></div>
        </div>
      ))}
    </div>
  );
}

export function UsersSkeleton() {
  return (
    <LoadingRegion label="Loading users…" className="people-layout">
      <div className="skeleton-index">
        <Skeleton width="100%" height={30} radius={7} />
        <Skeleton width={80} height={10} className="skeleton-index-title" />
        {range(7).map(index => <Skeleton key={index} width={widths[index % widths.length]} height={12} />)}
      </div>
      <div className="skeleton-surface"><PeopleTableSkeleton /></div>
    </LoadingRegion>
  );
}

export function DepartmentsSkeleton() {
  return (
    <LoadingRegion label="Loading departments…">
      <div className="skeleton-surface">
        <div className="skeleton-table">
          <div className="skeleton-table-head departments"><Skeleton width={80} height={9} /><Skeleton width={36} height={9} /><Skeleton width={46} height={9} /><span /></div>
          {range(8).map(index => (
            <div className="skeleton-table-row departments" key={index}>
              <div><Skeleton width={widths[index % widths.length]} height={13} /><Skeleton width="38%" height={10} /></div>
              <Skeleton width={18} height={12} /><Skeleton width={18} height={12} />
              <div className="skeleton-actions"><Skeleton width={16} height={16} radius={4} /><Skeleton width={16} height={16} radius={4} /></div>
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ReportAccessSkeleton() {
  return (
    <LoadingRegion label="Loading report access…" className="access-layout">
      <div className="skeleton-surface skeleton-library">
        <div className="skeleton-library-head"><Skeleton width={120} height={13} /><div><Skeleton width={110} height={30} radius={999} /><Skeleton width={96} height={30} radius={999} /></div></div>
        <ReportRowsSkeleton rows={6} />
      </div>
      <div>
        <Skeleton width={90} height={13} className="skeleton-board-title" />
        <div className="skeleton-board">
          {range(6).map(index => (
            <div className="skeleton-surface skeleton-department" key={index}>
              <Skeleton width={widths[(index + 4) % widths.length]} height={13} /><Skeleton width={90} height={10} />
              <span className="skeleton-divider" />
              {range(index % 3).map(row => <Skeleton key={row} width="80%" height={11} />)}
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

/** Rows inside a settings group (database logins). */
export function SettingRowsSkeleton({ rows = 2, label }: { rows?: number; label: string }) {
  return (
    <LoadingRegion label={label}>
      <div className="skeleton-surface skeleton-setting-rows">
        {range(rows).map(index => (
          <div className="skeleton-setting-row" key={index}>
            <div><Skeleton width={widths[(index + 5) % widths.length]} height={13} /><Skeleton width="70%" height={10} /></div>
            <Skeleton width={84} height={32} radius={8} />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** A report's parameter form, before the report's definition arrives. */
export function ReportFormSkeleton() {
  return (
    <LoadingRegion label="Loading report…" className="skeleton-report-form">
      <Skeleton width={150} height={15} />
      <Skeleton width="55%" height={11} />
      <div className="skeleton-fields">
        {range(2).map(index => (
          <div key={index}><Skeleton width={70} height={11} /><Skeleton width="100%" height={36} radius={8} /></div>
        ))}
      </div>
      <div className="skeleton-form-foot"><Skeleton width={180} height={11} /><Skeleton width={128} height={36} radius={8} /></div>
    </LoadingRegion>
  );
}

export function ActivitySkeleton() {
  return (
    <LoadingRegion label="Loading activity…">
      <div className="skeleton-rows">
        {range(6).map(index => (
          <div className="skeleton-row" key={index}>
            <Skeleton width={32} height={32} radius={8} />
            <div><Skeleton width={widths[(index + 6) % widths.length]} height={13} /><Skeleton width={180} height={10} /></div>
            <Skeleton width={70} height={10} />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** The whole workspace, while the session or the workspace itself is loading: the frame appears at once. */
export function ShellSkeleton({ label = "Loading 1Reports…" }: { label?: string }) {
  return (
    <div className="app collapsed comfortable shell-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="sidebar shell-skeleton-rail" aria-hidden="true">
        <Skeleton width={30} height={30} radius={8} className="shell-skeleton-mark" />
        {range(4).map(index => <Skeleton key={index} width={20} height={20} radius={6} />)}
      </div>
      <div className="main-shell" aria-hidden="true">
        <div className="topbar"><Skeleton width="min(440px, 60%)" height={36} radius={8} /><Skeleton width={96} height={36} radius={8} /></div>
        <div className="main-scroll">
          <main>
            <Skeleton width={160} height={26} radius={6} className="shell-skeleton-title" />
            <ReportTableSkeleton rows={6} />
          </main>
        </div>
      </div>
    </div>
  );
}
