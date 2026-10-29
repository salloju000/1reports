import { ArrowRight } from "lucide-react";
import { PageHeading } from "../components/Workspace";
import { navigate } from "../hooks/useHub";
export function HelpPage() {
  return (
    <>
      <PageHeading
        title="Help & Support"
        description="A practical guide to your reporting workspace."
      />
      <section className="panel help-panel">
        <h2>Find your next report</h2>
        <p>
          Search by report name, description, category, keyword, or code.
          Combine filters in All Reports to narrow your results. Category cards
          take you directly to a filtered catalog.
        </p>
        <h2>Keep important reports close</h2>
        <p>
          Select the star beside any report to save it to Favorites. Favorites,
          display preferences, and prototype interactions are stored locally in
          your browser.
        </p>
        <h2>Try a report demonstration</h2>
        <p>
          Open a report, complete its required parameters, and select Run
          demonstration. The processing screen waits for you to select Show demo
          result. All previews are illustrative sample data; PDF and Excel
          generation are unavailable.
        </p>
        <h2>About EFI Reporting Hub</h2>
        <p>
          Version 1.0 · Frontend prototype for EFI Radius Classic workflows.
          This independent demonstration has no connection to SQL Server, EFI
          Radius, SAP Crystal Reports, company audit logs, or a real identity
          service.
        </p>
        <button className="button primary" onClick={() => navigate("reports")}>
          Explore reports
          <ArrowRight size={15} />
        </button>
      </section>
    </>
  );
}
