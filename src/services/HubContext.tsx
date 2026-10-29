import { createContext, useContext, type ReactNode } from "react";
import type { CatalogMetadata } from "../types";
import type { ReportRepository } from "./contracts";
import { repository } from "./repository";
import type { PreferencesPersistence } from "./preferences";
import { preferencesPersistence } from "./storage";

const HubContext = createContext<{
  repository: ReportRepository;
  metadata?: CatalogMetadata;
  persistence: PreferencesPersistence;
}>({ repository, persistence: preferencesPersistence });
export function HubProvider({
  children,
  repository,
  metadata,
  persistence,
}: {
  children: ReactNode;
  repository: ReportRepository;
  metadata?: CatalogMetadata;
  persistence: PreferencesPersistence;
}) {
  return (
    <HubContext.Provider value={{ repository, metadata, persistence }}>
      {children}
    </HubContext.Provider>
  );
}
export const useHub = () => useContext(HubContext);
