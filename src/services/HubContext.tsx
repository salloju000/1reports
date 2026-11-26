import { createContext, useContext, type ReactNode } from "react";
import type { CatalogMetadata } from "../types";
import type { ReportRepository } from "./contracts";
import { repository } from "./emptyRepository";
import type { PreferencesPersistence } from "./preferences";
import { preferencesPersistence } from "./storage";

/** Who is signed in, as far as the report pages need to know: to explain an empty list, for example. */
export type Audience = { administrator: boolean; department: string | null };

const HubContext = createContext<{
  repository: ReportRepository;
  metadata?: CatalogMetadata;
  persistence: PreferencesPersistence;
  pendingFavorites?: ReadonlySet<string>;
  audience?: Audience;
}>({ repository, persistence: preferencesPersistence });
export function HubProvider({
  children,
  repository,
  metadata,
  persistence,
  pendingFavorites,
  audience,
}: {
  children: ReactNode;
  repository: ReportRepository;
  metadata?: CatalogMetadata;
  persistence: PreferencesPersistence;
  pendingFavorites?: ReadonlySet<string>;
  audience?: Audience;
}) {
  return (
    <HubContext.Provider value={{ repository, metadata, persistence, pendingFavorites, audience }}>
      {children}
    </HubContext.Provider>
  );
}
export const useHub = () => useContext(HubContext);
