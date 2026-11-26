/**
 * Dev-only design preview (open /preview.html with `npm run dev:frontend`). Renders the real app
 * with a stand-in API and sample data so screens can be reviewed without the Hub database or the
 * Crystal runtime. Add ?role=user to see the app as a regular user. Not part of the production build.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../App";
import type { Organization } from "../services/organization";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "../styles.css";

const administrator = new URLSearchParams(window.location.search).get("role") !== "user";
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();

const reports = [
  { id: "inv", name: "SRPL-InvRefNEW-4x6", category: "Inventory labels", updatedAt: day(2) },
  { id: "outer", name: "SRPL-OuternEW-4x6", category: "Inventory labels", updatedAt: day(4) },
  { id: "rolls", name: "SRPL-RollsNew-4x6", category: "Inventory labels", updatedAt: day(6) },
  { id: "waste", name: "SRPL-WasteOutputBreakdown", category: "Inventory labels", updatedAt: day(9) },
  { id: "wasteNew", name: "SRPL-WasteOutputNew", category: "Inventory labels", updatedAt: day(11) },
  { id: "wip", name: "SRPL-WIPNew-4x6", category: "Inventory labels", updatedAt: day(12) },
  { id: "slitting", name: "WIP Stock Details For Slitting", category: "Inventory labels", updatedAt: day(14) },
  { id: "estimate", name: "Job Cost Estimate", category: "Estimation", updatedAt: day(3) },
  // A real-world name with no spaces, to review how long names wrap and truncate.
  { id: "inks", name: "Estimate_Detail__Inks_Job&EstCode_ByPlant_Summary", category: "Estimation", updatedAt: day(1) },
  { id: "pouch-qc", name: "Pouch Seal Strength", category: "Quality", updatedAt: day(5) },
];
// Reports whose database still needs a saved login in this preview.
const needsLogin = new Set(["outer", "slitting"]);
const saved = new Set<string>();
const prompts = [
  { name: "Barcode", label: "Barcode", kind: "String", optional: false, multiple: false, range: false, choices: [] },
  { name: "Plant", label: "Plant", kind: "String", optional: false, multiple: false, range: false, choices: ["P01", "P02", "P03"] },
];
const databases: Record<string, { id: string; label: string }> = {
  outer: { id: "plant", label: "PlantmanagerTest" },
  slitting: { id: "vision", label: "visionTest" },
};

// A data report with every kind of parameter, to review the report viewer's controls.
const estimatePrompts = [
  { name: "period", label: "Order date", kind: "Date", optional: false, multiple: false, range: true, choices: [] },
  { name: "plants", label: "Plants", kind: "String", optional: false, multiple: true, range: false,
    choices: ["P01 Chakan", "P02 Daman", "P03 Silvassa", "P04 Pune", "P05 Nashik", "P06 Vapi", "P07 Surat", "P08 Baroda", "P09 Indore", "P10 Nagpur"] },
  { name: "customers", label: "Customer codes", kind: "String", optional: true, multiple: true, range: false, choices: [] },
  { name: "grade", label: "Material grade", kind: "String", optional: true, multiple: false, range: false, choices: ["BOPP", "PET", "LDPE", "CPP"] },
  { name: "minQty", label: "Minimum quantity (kg)", kind: "Number", optional: true, multiple: false, range: false, choices: [] },
  { name: "closed", label: "Include closed jobs", kind: "Boolean", optional: true, multiple: false, range: false, choices: [] },
];

/** A one-page PDF and a small .xlsx, so the preview can show a finished run. */
function samplePdf() {
  // Three 4 x 6 in label pages, like the inventory label reports.
  const pages = [1, 2, 3];
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}]/Count ${pages.length}>>`,
  ];
  for (const page of pages) {
    const content = [
      "0.85 g 18 360 252 54 re f 0 g",
      "BT /F1 18 Tf 30 395 Td (SRPL INVENTORY) Tj ET",
      `BT /F1 11 Tf 30 330 Td (Barcode: 1100000079${70 + page}) Tj ET`,
      "BT /F1 11 Tf 30 310 Td (Plant: P02) Tj ET",
      `BT /F1 11 Tf 30 290 Td (Roll ${page} of 3   Weight: ${180 + page * 7}.5 kg) Tj ET`,
      ...Array.from({ length: 28 }, (_, i) => `${40 + i * 7.5} 120 ${i % 3 ? 2 : 4} 120 re f`),
    ].join("\n");
    objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 288 432]/Contents ${4 + (page - 1) * 2} 0 R/Resources<</Font<</F1 ${3 + pages.length * 2} 0 R>>>>>>`);
    objects.push(`<</Length ${content.length}>>stream\n${content}\nendstream`);
  }
  objects.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>");
  const text = ["%PDF-1.4", ...objects.map((body, i) => `${i + 1} 0 obj${body}endobj`), "trailer<</Root 1 0 R>>", "%%EOF"].join("\n");
  return new Blob([text], { type: "application/pdf" });
}
function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function sampleXlsx() {
  const rows = [["Job no", "Customer", "Plant", "Order date", "Quantity (kg)", "Value"]];
  for (let index = 1; index <= 40; index++)
    rows.push([`J-${24000 + index}`, ["Asian Foods", "Brite Pack", "Coastal Dairy", "Delta Snacks"][index % 4],
      `P0${(index % 5) + 1}`, `2026-11-${String((index % 18) + 1).padStart(2, "0")}`, String(150 + index * 37), (index * 1234.5).toFixed(2)]);
  const cell = (value: string, column: number, row: number) => {
    const ref = String.fromCharCode(65 + column) + (row + 1);
    return /^-?\d+(\.\d+)?$/.test(value) ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(value, c, r)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files: [string, string][] = [["xl/worksheets/sheet1.xml", sheet]];
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = encoder.encode(content), nameBytes = encoder.encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true); entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function detail(id: string) {
  const report = reports.find(item => item.id === id)!;
  const pending = needsLogin.has(id) && !saved.has(databases[id].id);
  const connection = databases[id] ?? { id: "plant", label: "PlantmanagerTest" };
  return {
    id, name: report.name, version: "v1",
    prompts: pending ? [] : id === "estimate" ? estimatePrompts : prompts,
    setupRequired: pending,
    canConfigure: administrator,
    connections: administrator ? [{ ...connection, status: pending ? "needs-login" : "ready" }] : [],
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.href).pathname.replace(/^.*\/api\//, "");
  const method = init?.method ?? "GET";
  await new Promise(resolve => setTimeout(resolve, 250));
  if (!url.includes("/api/")) return realFetch(input, init);
  if (path === "auth/csrf") return Response.json({ token: "preview" });
  if (path === "account/preferences") return new Response(null, { status: 204 });
  // Organization branding (the logo itself isn't served by the preview: the header shows a broken image).
  if (path === "admin/organization" && method === "PUT") {
    const name = String(JSON.parse(String(init?.body ?? "{}")).name ?? "").trim();
    branding = { ...branding, name: name || null };
    return Response.json(branding);
  }
  if (path === "admin/organization/logo") {
    branding = { ...branding, logo: method === "PUT" ? `organization/logo?v=${Date.now()}` : null };
    return Response.json(branding);
  }
  if (path === "account/password") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return body.currentPassword === "preview-password" ? new Response(null, { status: 204 })
      : Response.json({ errors: { currentPassword: ["Your current password is incorrect."] } }, { status: 400 });
  }
  // As on the server: administrators see every report, users only their department's (Printing here).
  if (path === "workspace") return Response.json({
    reports: administrator ? reports : reports.filter(report => held("dep-4").has(report.id)),
    favorites: ["inv"], activity: [
    { reportId: "inv", interactionId: "a", kind: "run-completed", at: day(1) },
    { reportId: "rolls", interactionId: "b", kind: "viewed", at: day(2) },
  ] });
  const view = path.match(/^reports\/([^/]+)\/view$/);
  if (view) return new Response(null, { status: 204 });
  const render = path.match(/^reports\/([^/]+)\/render$/);
  if (render) {
    // Add ?run=fail to the preview address to see a failed run.
    if (new URLSearchParams(window.location.search).get("run") === "fail")
      return Response.json({ code: "datasource-unavailable" }, { status: 502 });
    // ?run=slow takes 14 seconds, to watch the run's progress messages.
    await new Promise(resolve => setTimeout(resolve, new URLSearchParams(window.location.search).get("run") === "slow" ? 14000 : 1800));
    const format = JSON.parse(String(init?.body ?? "{}")).format;
    return new Response(format === "xlsx" ? sampleXlsx() : samplePdf());
  }
  const report = path.match(/^reports\/([^/]+)$/);
  if (report) return Response.json(detail(report[1]));
  const login = path.match(/^admin\/report-databases\/([^/]+)$/);
  if (login && method === "PUT") { saved.add(login[1]); return Response.json({ id: login[1], status: "saved" }); }
  if (path === "admin/report-folders") return Response.json([{ key: "labels", category: "Inventory labels" }]);
  if (path === "admin/report-databases") return Response.json([
    { id: "plant", label: "PlantmanagerTest", source: "PlantManager", database: "PlantmanagerTest", provider: "ODBC (RDO)",
      status: saved.has("plant") ? "saved" : "needs-login", login: saved.has("plant") ? "plant_reader" : undefined,
      reports: ["SRPL-InvRefNEW-4x6", "SRPL-OuternEW-4x6", "SRPL-RollsNew-4x6"] },
    { id: "vision", label: "visionTest", source: "visionTest", database: "visionTest", provider: "ODBC (RDO)",
      status: "needs-login", reports: ["WIP Stock Details For Slitting"] },
  ]);
  const directory = previewPeople(path, method, init?.body);
  if (directory) return directory;
  return new Response(null, { status: 404 });
};

// People administration stand-in: a handful of departments and people, kept in memory.
const departments = ["Estimation", "Pouching & Bag Making", "Slitting & Rewinding", "Printing", "Lamination",
  "Quality Assurance", "Stores & Inventory", "Dispatch & Logistics"]
  .map((name, index) => ({ id: `dep-${index + 1}`, name, description: null as string | null }));
const staff = [
  { id: "u1", fullName: "Admin User", userName: "admin@srpl.example", email: "admin@srpl.example", departmentId: "dep-4", active: true, administrator: true, invitationPending: false },
  { id: "u2", fullName: "Asha Patil", userName: "asha.patil", email: "asha.patil@srpl.example", departmentId: "dep-1", active: true, administrator: false, invitationPending: false },
  { id: "u3", fullName: "Ravi Kumar", userName: "ravi.kumar", email: "ravi.kumar@srpl.example", departmentId: "dep-1", active: true, administrator: false, invitationPending: true },
  { id: "u4", fullName: "Meena Iyer", userName: "meena.iyer", email: "meena.iyer@srpl.example", departmentId: "dep-2", active: false, administrator: false, invitationPending: false },
  { id: "u5", fullName: "Sunil Rao", userName: "sunil.rao", email: "sunil.rao@srpl.example", departmentId: "dep-5", active: true, administrator: false, invitationPending: false },
];
// Department collections: department id -> report ids.
const collections = new Map<string, Set<string>>([["dep-3", new Set(["rolls", "slitting"])], ["dep-1", new Set(["inv"])],
  ["dep-4", new Set(["inv", "wip"])]]);
const held = (id: string) => collections.get(id) ?? collections.set(id, new Set()).get(id)!;
function previewPeople(path: string, method: string, raw: BodyInit | null | undefined) {
  const body = typeof raw === "string" ? JSON.parse(raw) : {};
  if (path === "admin/report-assignments") return Response.json({
    reports: reports.map(({ id, name, category }) => ({ id, name, category })),
    departments: departments.map(row => ({ id: row.id, name: row.name,
      users: staff.filter(user => user.departmentId === row.id).length, reportIds: [...held(row.id)] })),
  });
  if (path === "admin/report-assignments/move") {
    held(body.from).delete(body.reportId);
    held(body.to).add(body.reportId);
    return new Response(null, { status: 204 });
  }
  const assignment = path.match(/^admin\/departments\/([^/]+)\/reports\/([^/]+)$/);
  if (assignment) {
    if (method === "PUT") held(assignment[1]).add(decodeURIComponent(assignment[2]));
    else held(assignment[1]).delete(decodeURIComponent(assignment[2]));
    return new Response(null, { status: 204 });
  }
  const counted = () => departments.map(row => ({ ...row, users: staff.filter(user => user.departmentId === row.id).length,
    reports: held(row.id).size }));
  if (path === "admin/departments" && method === "GET") return Response.json(counted());
  if (path === "admin/departments" && method === "POST") {
    departments.push({ id: `dep-${Date.now()}`, name: body.name, description: null });
    return Response.json(counted().at(-1), { status: 201 });
  }
  const department = path.match(/^admin\/departments\/([^/]+)$/);
  if (department && method === "PUT") {
    Object.assign(departments.find(row => row.id === department[1])!, { name: body.name });
    return Response.json({});
  }
  if (department && method === "DELETE") {
    departments.splice(departments.findIndex(row => row.id === department[1]), 1);
    return new Response(null, { status: 204 });
  }
  if (path === "admin/users" && method === "GET") return Response.json(staff);
  if (path === "admin/users" && method === "POST") {
    if (staff.some(user => user.userName === body.userName))
      return Response.json({ errors: { userName: ["This username is already in use."] } }, { status: 400 });
    const user = { id: `u${Date.now()}`, fullName: body.fullName, userName: body.userName, email: body.email,
      departmentId: body.departmentId, active: body.active !== false, administrator: false, invitationPending: body.access === "invite" };
    staff.push(user);
    return Response.json({ user, invitation: user.invitationPending ? { userId: user.id, token: "preview-token" } : null }, { status: 201 });
  }
  const status = path.match(/^admin\/users\/([^/]+)\/status$/);
  if (status) {
    const user = staff.find(row => row.id === status[1])!;
    if (user.administrator && !body.active)
      return Response.json({ detail: "You can't deactivate your own account." }, { status: 409 });
    user.active = body.active;
    return Response.json(user);
  }
  const invitation = path.match(/^admin\/users\/([^/]+)\/invitation$/);
  if (invitation) return Response.json({ userId: invitation[1], token: "preview-token" });
  const user = path.match(/^admin\/users\/([^/]+)$/);
  if (user && method === "PUT") {
    const row = staff.find(item => item.id === user[1])!;
    Object.assign(row, { fullName: body.fullName, userName: body.userName, email: body.email, departmentId: body.departmentId });
    return Response.json(row);
  }
  return null;
}

let branding: Organization = { name: "Shree Rama Packaging", logo: null };

function Preview() {
  const [organization, setOrganization] = React.useState(branding);
  return (
    <App session={{
      organization, onOrganizationChange: setOrganization,
      email: administrator ? "admin@srpl.example" : "operator@srpl.example",
      administrator, busy: false, error: "", signOut: () => undefined, onUnauthorized: () => undefined,
      fullName: administrator ? "Admin User" : "Asha Patil",
      department: administrator ? { id: "dep-6", name: "Quality Assurance" } : { id: "dep-4", name: "Printing" },
    }} />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
