// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hub.example.test/"}
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { ReportDatabases, ReportUpload } from "./ReportAdministration";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Call = { url: string; method: string; body?: BodyInit | null };

function stub(handler: (url: string, method: string, body?: BodyInit | null) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (url.endsWith("/csrf")) return Response.json({ token: "token" });
    calls.push({ url, method, body: options?.body });
    return handler(url, method, options?.body) ?? new Response(null, { status: 404 });
  }));
  return calls;
}

const staged = {
  token: "a".repeat(32), fileName: "Stock.rpt", folder: "labels", category: "Inventory labels", prompts: 2, exists: false,
  connections: [
    { id: "plant", label: "PlantmanagerTest", database: "PlantmanagerTest", status: "saved" },
    { id: "vision", label: "visionTest", database: "visionTest", status: "needs-login" },
  ],
};

it("asks for a login only for databases without one, then publishes the upload", async () => {
  const onPublished = vi.fn();
  const calls = stub((url, method) => {
    if (url.endsWith("admin/report-folders")) return Response.json([{ key: "labels", category: "Inventory labels" }]);
    if (url.endsWith("admin/report-uploads") && method === "POST") return Response.json(staged);
    if (url.includes("admin/report-databases/vision")) return Response.json({ id: "vision", status: "saved" });
    if (url.endsWith("/publish")) return Response.json({ fileName: "Stock.rpt" });
  });
  render(<ReportUpload onPublished={onPublished} />);

  const file = new File([new Uint8Array([0xd0, 0xcf])], "Stock.rpt");
  fireEvent.change(await screen.findByLabelText("Report file"), { target: { files: [file] } });
  expect(screen.getByText("Stock.rpt")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  expect(await screen.findByRole("heading", { name: "Stock.rpt" })).toBeVisible();
  // Only the database without a saved login asks for one.
  expect(screen.getAllByLabelText("Login")).toHaveLength(1);
  expect(screen.getByRole("group", { name: "Database login: visionTest" })).toBeVisible();
  const publish = screen.getByRole("button", { name: "Publish report" });
  expect(publish).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Login"), { target: { value: "vision_reader" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Test and save login" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish report" })).toBeEnabled());
  const save = calls.find(call => call.url.includes("admin/report-databases/vision"))!;
  expect(JSON.parse(String(save.body))).toEqual({ login: "vision_reader", password: "typed-secret", upload: staged.token });

  fireEvent.click(screen.getByRole("button", { name: "Publish report" }));
  expect(await screen.findByText(/Stock.rpt is published/)).toBeVisible();
  expect(onPublished).toHaveBeenCalled();
  const published = calls.find(call => call.url.endsWith("/publish"))!;
  expect(JSON.parse(String(published.body))).toEqual({ replace: false });
});

it("requires choosing to replace a report that already exists", async () => {
  stub(url => {
    if (url.endsWith("admin/report-folders")) return Response.json([{ key: "labels", category: "Inventory labels" }]);
    if (url.endsWith("admin/report-uploads")) return Response.json({ ...staged, exists: true,
      connections: [staged.connections[0]] });
  });
  render(<ReportUpload onPublished={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Report file"),
    { target: { files: [new File(["x"], "Stock.rpt")] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  const publish = await screen.findByRole("button", { name: "Publish report" });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Replace the existing report/));
  expect(publish).toBeEnabled();
});

it("lists each database with its saved login but never a password", async () => {
  stub(url => {
    if (url.endsWith("admin/report-databases")) return Response.json([
      { id: "plant", label: "PlantmanagerTest", source: "PlantManager", database: "PlantmanagerTest", provider: "ODBC (RDO)",
        status: "saved", login: "plant_reader", reports: ["SRPL-InvRefNEW-4x6"] },
      { id: "vision", label: "visionTest", source: "visionTest", database: "visionTest", provider: "ODBC (RDO)",
        status: "needs-login", reports: ["WIP Stock Details"] },
    ]);
  });
  render(<ReportDatabases revision={0} />);
  expect(await screen.findByText("PlantmanagerTest")).toBeVisible();
  expect(screen.getByText("Login saved")).toBeVisible();
  expect(screen.getByText(/Login: plant_reader/)).toBeVisible();
  // A count of the reports, not their names.
  expect(screen.getAllByText("1 report")).toHaveLength(2);
  expect(screen.queryByText(/Used by/)).not.toBeInTheDocument();
  expect(screen.getByText("Needs a login")).toBeVisible();
  expect(screen.getByRole("button", { name: "Change login" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add login" }));
  expect(screen.getByRole("group", { name: "Database login: visionTest" })).toBeVisible();
});
