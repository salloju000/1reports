import type { DemoPreview } from "../../types";
const previews: Record<string, Omit<DemoPreview, "company">> = {
  finance: {
    columns: ["Account", "Debit (INR)", "Credit (INR)"],
    rows: [
      ["DEMO · Cash", "125,400.00", "0.00"],
      ["DEMO · Revenue", "0.00", "125,400.00"],
    ],
  },
  sales: {
    columns: ["Customer", "Sample orders", "Revenue (INR)"],
    rows: [
      ["DEMO · Acme Retail", "12", "125,400.00"],
      ["DEMO · Valley Foods", "8", "86,250.00"],
    ],
  },
  inventory: {
    columns: ["Material", "Sample quantity", "Value (INR)"],
    rows: [
      ["DEMO · Kraft board", "2,400 kg", "125,400.00"],
      ["DEMO · Printing ink", "350 kg", "86,250.00"],
    ],
  },
  purchasing: {
    columns: ["Purchase order", "Supplier", "Sample value (INR)"],
    rows: [
      ["DEMO-PO-001", "Sample Paper Mills", "125,400.00"],
      ["DEMO-PO-002", "Sample Ink Supply", "86,250.00"],
    ],
  },
  production: {
    columns: ["Work order", "Sample output", "Status"],
    rows: [
      ["DEMO-WO-001", "12,500 cartons", "In progress"],
      ["DEMO-WO-002", "8,000 labels", "Completed"],
    ],
  },
  receivable: {
    columns: ["Customer", "Current (INR)", "Overdue (INR)"],
    rows: [
      ["DEMO · Acme Retail", "125,400.00", "12,500.00"],
      ["DEMO · Valley Foods", "86,250.00", "0.00"],
    ],
  },
  payable: {
    columns: ["Supplier", "Due (INR)", "Payment status"],
    rows: [
      ["DEMO · Sample Paper Mills", "125,400.00", "Scheduled"],
      ["DEMO · Sample Ink Supply", "86,250.00", "Pending"],
    ],
  },
  administration: {
    columns: ["Sample record", "Branch", "Status"],
    rows: [
      ["DEMO · User access review", "Mumbai", "Reviewed"],
      ["DEMO · Period closure", "Pune", "Pending"],
    ],
  },
};
export function previewFor(categoryId: string): DemoPreview {
  return {
    company: "Northstar Packaging Ltd.",
    ...(previews[categoryId] ?? previews.administration),
  };
}
