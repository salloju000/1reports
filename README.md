<div align="center">

<img src="public/1reports-logo.png" alt="1Reports" width="360">

### Crystal Reports for EFI Radius Classic, in the browser

Find a report, fill in its parameters, and get a PDF — with sign-in, department access and full activity history.

<br>

![React](https://img.shields.io/badge/React-19-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)
![.NET](https://img.shields.io/badge/.NET-10-512bd4?style=flat-square&logo=dotnet&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-Hub%20DB-cc2927?style=flat-square&logo=microsoftsqlserver&logoColor=white)
![IIS](https://img.shields.io/badge/Hosted%20on-IIS-0078d4?style=flat-square&logo=windows&logoColor=white)
![Crystal Reports](https://img.shields.io/badge/Crystal%20Reports-runtime-c9a14a?style=flat-square)

**[Getting started](#1-prerequisites)** ·
**[Run locally](#3-run-it-locally)** ·
**[Release](#6-build-a-release-for-iis)** ·
**[Deploy](#7-deploy-to-the-server)** ·
**[Configuration](#9-configuration-reference)**

</div>

---

## Features

- **Report catalog** – search, filter and favorite every published Crystal report, grouped by category.
- **Automatic parameters** – each report's prompts (including subreports, ranges and value lists) are read from the `.rpt` itself; nothing is set up by hand.
- **PDF output** – runs happen on the server and open in a built-in PDF viewer, with live progress.
- **Batch reports** – open up to eight reports side by side and run them all with one click.
- **People and access** – employee accounts, departments and per-department report collections, managed by administrators.
- **Database sign-in your way** – Windows identity, a stored service login, or a login typed per run; saved logins are encrypted.
- **Activity history** – a record of the reports each person opened and ran.
- **Organization branding** – name and logo set from Settings.

## Overview

1Reports has three parts:

| Part | Folder | Technology | Runs on |
| --- | --- | --- | --- |
| Web app (what people see) | `src/`, `public/` | React 19, TypeScript, Vite, Tailwind | Any browser |
| API | `server/` | ASP.NET Core (.NET 10), ASP.NET Core Identity, EF Core, SQL Server | IIS on the report server |
| Crystal worker | `crystal-worker/` | .NET Framework 4.8 + SAP Crystal Reports runtime | The report server only |

The API stores employee accounts, departments, report access, favorites, activity and saved database logins in a dedicated SQL Server database (the "Hub" database). When someone runs a report, the API starts the Crystal worker, which reads the `.rpt` template, signs in to the report's database and returns a PDF.

---

## 1. Prerequisites

Install these on your development PC:

1. **Git** – https://git-scm.com/download/win
2. **Node.js 20 or newer** (includes `npm`) – https://nodejs.org
3. **.NET 10 SDK** – https://dotnet.microsoft.com/download
4. **EF Core tools** (only needed when you change the database model):
   ```powershell
   dotnet tool install --global dotnet-ef
   ```
5. **SQL Server** you can reach, plus **SSMS** for running the SQL scripts.

The Crystal worker can only be built and run on a machine with the **SAP Crystal Reports runtime for .NET** installed (the report server). You do not need it to work on the web app or API.

---

## 2. Get the code

```powershell
git clone https://github.com/salloju000/1reports.git
```

```powershell
cd 1reports
```

```powershell
npm install
```

---

## 3. Run it locally

### 3a. Web app only (no sign-in, quickest)

```powershell
npm run dev:frontend
```

Open http://127.0.0.1:5173. This shows the workspace shell with empty data. Sign-in and the SQL forms are not available in this mode.

### 3b. Web app + API

```powershell
npm run dev
```

This starts Vite and the ASP.NET Core API together (API on `http://127.0.0.1:5182`; set `HUB_DEV_API_PORT` to change it). Without a Hub database the API still starts, but sign-in is disabled.

### 3c. Full local sign-in (HTTPS + Hub database)

Sign-in cookies require HTTPS, so:

1. Create an empty SQL Server database for development, e.g. `1ReportsDev`.
2. Create the tables by running `publish/HubIdentity.sql` against it in SSMS (it is idempotent, safe to re-run).
3. Make a trusted certificate for `localhost` as PEM files (for example with `mkcert localhost`). **Keep the key file outside this repository.**
4. Set the environment variables in the same PowerShell window and start:
   ```powershell
   $env:ConnectionStrings__Hub = "Server=localhost;Database=1ReportsDev;Integrated Security=true;TrustServerCertificate=true"
   $env:HUB_DEV_HTTPS_CERT = "C:\certs\localhost.pem"
   $env:HUB_DEV_HTTPS_KEY  = "C:\certs\localhost-key.pem"
   npm run dev -- --host localhost
   ```
5. Create the first administrator account (one time) — see [step 7](#7-create-the-first-administrator).
6. Open the printed `https://localhost:...` URL and sign in.

---

## 4. Test before you commit

Run all four. They must pass before building a release.

```powershell
npm test
```

```powershell
npm run typecheck
```

```powershell
npm run build
```

```powershell
dotnet test server.tests/1Reports.Tests.csproj
```

---

## 5. Changing the database model

When you change anything in `server/HubIdentityDb.cs`:

1. Add a migration:
   ```powershell
   dotnet ef migrations add <ShortName> --project server
   ```
2. Regenerate the full deployment script (the publish script refuses to build if this is stale):
   ```powershell
   dotnet ef migrations script --idempotent --project server --output publish/HubIdentity.sql
   ```
3. Write a matching `scripts/create-<name>.sql` for the DBA that applies just this migration and grants the `IIS APPPOOL\1Reports` user what it needs (copy an existing `scripts/create-*.sql` as a template).

---

## 6. Build a release for IIS

Run this from the repository folder in **Windows PowerShell** (as its own process, so harmless npm warnings don't stop it):

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/publish-iis.ps1 -OutputDirectory publish/release-<yyyymmdd>-<name>
```

The script:

1. Checks `publish/HubIdentity.sql` includes the newest migration.
2. Publishes the API as a self-contained `win-x64` app (`1Reports.exe`, `web.config`).
3. Builds the web app into `wwwroot/` with base path `/1Reports/` (change with `-BasePath`).
4. Copies `HubIdentity.sql` and writes `release-manifest.json` with a SHA-256 hash of every file.

The output folder must not already exist. Release folders are ignored by Git.

---

## 7. Deploy to the server

The live server is `WIN-4IIIIVPF045` (IIS site folder `C:\publish\1Reports`, app pool `1Reports`, URL path `/1Reports/`, Hub database `testIdentity`). It is reached through Remote Desktop; the dev PC's `D:` drive appears there as `\\tsclient\D`.

1. **Copy the release** folder to the server's `C:\publish\` (running from `\\tsclient` works but is very slow).
2. **Database first.** A DBA runs the release's new SQL in SSMS on the Hub instance: each new `scripts/create-*.sql` / `scripts/add-*.sql`, in the order written at the top of each file. All are safe to run more than once.
3. **Deploy the files.** On the server, in an **Administrator** PowerShell:
   ```powershell
   & '\\tsclient\D\SSSSS\EFI Reports\scripts\deploy-release.ps1' -Release 'C:\publish\release-<name>' -DatabaseUpdated
   ```
   (The script itself can be run from the mapped drive; only the release files need to be local.) It verifies every file against the manifest, stops the pool, backs up and replaces only changed files, **never touches `web.config` or `appsettings*.json`**, starts the pool, and rolls back automatically if anything fails.
4. **If the Crystal worker changed**, rebuild it on the server (step 8).
5. **Check it's live:**
   ```powershell
   [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; (Invoke-WebRequest https://localhost/1Reports/ -UseBasicParsing).StatusCode
   ```
   `200` means the site is up. `https://localhost/1Reports/api/auth/me` should answer `401` (API running, not signed in). Then sign in from a browser.

### Create the first administrator

Only needed once for a new Hub database. On the server, run `scripts/start-admin-bootstrap.ps1` (it asks for the passwords with hidden input and never stores them). Locally you can do the same by setting `HUB_BOOTSTRAP_ADMIN=1`, `HUB_ADMIN_EMAIL` and `HUB_ADMIN_PASSWORD` and starting the API once. After that, add everyone else from **Users** inside the app.

---

## 8. Crystal worker (server only)

The worker is not part of the IIS release. Build it on the server, where the Crystal runtime is installed:

```powershell
& '<repo>\scripts\build-crystal-worker.ps1'
```

The script finds the Crystal assemblies in the server's GAC (or use `-CrystalSdkDir`). Point the app pool's `Crystal__WorkerPath` at the built `1Reports.Crystal.exe`. The API notices a new worker and re-reads every report template automatically. Always deploy the API and worker together when either changes.

Useful server tools:

- `scripts/explain-crystal-parameters.ps1` – lists every report parameter and how 1Reports handles it (read-only).
- `scripts/diagnose-crystal-run.sql` – shows the SQL a slow report run is sending (run in SSMS during the run).

---

## 9. Configuration reference

Set these as environment variables on the IIS app pool (or in the server's `appsettings.json`). In environment variables, `__` stands for a nested section. **Never commit passwords or connection strings with passwords.**

| Setting | Purpose |
| --- | --- |
| `ConnectionStrings__Hub` | Hub database (accounts, access, activity). Required for sign-in. |
| `Crystal__WorkerPath` | Full path to `1Reports.Crystal.exe`. |
| `Crystal__Roots__<name>__Path` | Folder of published `.rpt` templates; `__Category` and `__Roles__0` set the catalog category and who may see it. |
| `Crystal__Connections__<n>__Source` / `__Database` / `__Provider` | Approved report database, matched to each report's data source. |
| `Crystal__Connections__<n>__Authentication` | `Integrated` (app pool Windows identity), `Stored` (needs `__User` and `__PasswordEnvironmentVariable`), or `Prompt` (the user types a login per run). |
| `Crystal__Connections__<n>__Name` | Optional display name for the connection. |
| `Crystal__RenderTimeoutSeconds` | Max run time, 30–1800, default 300. If raised above ~330 also raise `runTimeout` in `src/pages/CrystalReports.tsx`. |
| `ReportSql__Host` / `__Port` / `__Database` | Approved target for the admin "SQL connection check" (more with `ReportSql__Targets__0__…`). |
| `HUB_BASE_PATH` (build time) | URL path of the app. Dev default `/`, release default `/1Reports/`. |

Security notes:

- The `sa` login is refused for every connection.
- Prompted database logins are sent over HTTPS, passed to the worker on standard input and discarded after the run — never logged or stored in the browser. Saved logins are encrypted with ASP.NET Data Protection (keys in `C:\ProgramData\EFIHub\keys`; don't rename or delete this folder or saved logins can't be decrypted).
- Five failed database sign-ins in five minutes pause further attempts for that person; five wrong account passwords lock the account for 15 minutes.
- Only two report runs proceed at once.

---

## 10. Project layout

```
src/            React web app (pages/, components/, services/, layouts/, hooks/)
public/         Logo, favicon
server/         ASP.NET Core API, EF Core migrations in server/Migrations
server.tests/   API integration tests (xUnit)
crystal-worker/ Crystal Reports worker (.NET 4.8, server only)
publish/        HubIdentity.sql (full idempotent DB script); release folders (ignored)
scripts/        Dev runner, publish/deploy PowerShell, DBA SQL scripts
```

---

## 11. Push your changes to GitHub

```powershell
git add -A
```

```powershell
git commit -m "Describe what changed"
```

```powershell
git push
```

Check `git status` before committing: never commit `appsettings.Production.json`, certificate keys, or anything with a password.
