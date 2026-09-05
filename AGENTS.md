# Ora — Agent instructions

## Working conventions

- Act as a senior engineer: be concise, direct, and focused on completing the task.
- Prefer the smallest explicit, maintainable solution. Avoid abstractions, layers, and dependencies that do not address a concrete need.
- Communicate in Spanish. Write repository documentation in English. Preserve other people's changes and keep each modification within the requested scope.
- Prefix terminal commands with `rtk`; `rtk proxy` runs commands without filtering their output.
- Do not use OpenSpec. Do not introduce additional approval processes; respect the user's authorization for each task, including the destination of commits.

## Product and scope

Time tracking for a company with two stores, up to ten employees, and desktop administration. Employees clock in from their phones, stay signed in, and can switch stores. Keep the interface very simple: clear text, large buttons, and few decisions.

The hosting and database budget is **€0**. Keep Vercel and Convex; do not enable paid plans, usage billing, domains, SMS, email, or additional services without a new explicit instruction. Do not add payroll, shift planning, geolocation, biometrics, or a multi-company architecture to the current scope.

Read [README.md](README.md) first for the product overview, local development, and deployment setup. For recovery, see [docs/RECOVERY.md](docs/RECOVERY.md).

## Architecture

React + TypeScript + Vite, custom CSS, and Convex Auth with username and password. Vercel serves a static SPA; Convex runs functions and stores data in the region selected for the deployment. There is no Next.js or custom server.

| Path                                                                  | Responsibility                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/App.tsx`, `src/main.tsx`                                         | Login, authentication sessions, and role-based interface selection.                             |
| `src/Worker.tsx`                                                      | Mobile clocking, personal history, and notices.                                                 |
| `src/Admin.tsx`, `Employees.tsx`, `Records.tsx`, `Reports.tsx`        | Administration dashboard, people, records, and reports. All four files are in `src/`.           |
| `src/components/`, `src/styles.css`                                   | Shared elements, printable document, and styles.                                                |
| `convex/schema.ts`, `convex/lib.ts`                                   | Data model, authorization, and common rules.                                                    |
| `convex/app.ts`, `admin.ts`, `accounts.ts`, `reports.ts`, `backup.ts` | Employee API, administration, accounts, reports, and recovery. All five files are in `convex/`. |
| `shared/time.ts`, `reports.ts`, `backup.ts`                           | Time, CSV, and encryption shared by frontend and backend. All three files are in `shared/`.     |
| `shared/restore-drill.mts`, `shared/capacity.mts`                     | Isolated restore drill and synthetic capacity estimate.                                         |

Before editing Convex code, read `convex/_generated/ai/guidelines.md` and the functions that consume the affected data. Convex regenerates the types and references in `convex/_generated/`; do not edit them manually. Keep arguments and return values validated and enforce permissions in the backend.

## Setup and commands

Use Node.js **24** and npm; keep `package-lock.json` as the source of installed versions. In a fresh checkout:

```sh
rtk proxy npm ci
rtk proxy cp .env.example .env.local
```

The second command is only for installations without `.env.local`; never overwrite an existing configuration. Set `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` for the selected deployment. Variables prefixed with `VITE_` are published in the browser and must never contain secrets. Building requires `VITE_CONVEX_URL`.

```sh
rtk proxy npm run dev             # Frontend at http://127.0.0.1:5173
rtk proxy npm run dev:backend     # Syncs Convex functions; modifies the deployment
rtk proxy npm run typecheck
rtk proxy npm test
rtk proxy npm run build
rtk proxy npm run check           # Types, tests, and build
```

`npm run setup:dev-auth` sets up development authentication and may modify remote variables. Read the README before using it; do not routinely regenerate existing keys or accounts. For small formatting changes, run Prettier only on modified files.

## Environments and data

- Identify and announce the effective deployment before running `dev`, `deploy`, mutations, imports, or variable changes. Cross-check `.env.local`, process environment variables, and CLI options.
- Verify which backend each installation uses; Vercel's production alias does not determine the Convex environment. The allowed deployment target is checked in `scripts/deploy-vercel.mjs`.
- Pushing to `main` in the repository connected to Vercel automatically deploys both frontend and backend from Vercel after running `npm run check`. `scripts/deploy-vercel.mjs` checks the branch, environment, and key; other branches are not deployed. A push to `main` is also an operation on the current backend. Do not add a second parallel deployment through GitHub Actions or use this backend's key in previews.
- **A deployment labeled as development may contain real data.** Do not treat it as disposable, insert fixtures, or run restores against it unless the task authorizes this.
- Create test accounts only in isolated environments and do not reuse credentials from other installations.
- Restore into an empty, isolated target. Do not overwrite operational records or copy real data into previews to test changes.
- Keep secrets, passwords, exports, and employment data out of Git, logs, and deployment artifacts. Respect `.gitignore` and `.vercelignore`; `.local/`, `.env.local`, `.vercel/`, `.playwright-cli/`, and `output/` are private or generated.
- Before committing, review the staged diff and push destination. Do not force-push `main`, overwrite other people's history, or deploy merely because documentation was edited.

## Rules to preserve

- Identity comes from the server-validated authentication session. Employees can only view their own data; revoking or disabling access must also invalidate sessions that are already open.
- Manual time entries use server time with whole-second precision. Automatic schedules use instants scheduled in `Europe/Madrid`, calculated and executed by the backend. Store UTC instants in milliseconds; reuse `shared/time.ts` for day, month, and daylight saving transitions.
- Only one work interval may be open per person. Prevent overlaps and duplicates and preserve idempotency. Switching stores closes and opens intervals at the same instant.
- There is no offline clocking queue. Call `app:clock` as an action over HTTP to prevent automatic mutation resubmission on reconnection. If the response is uncertain, query the operation; never assume it was saved without confirmation or resend it as a new entry.
- Agreed working hours remain an independent reference. Only an explicitly enabled weekly schedule generates clock-ins and clock-outs. An ended employment period must not prevent closing an interval that remains open.
- Intervals created by a schedule retain exactly the same schema and `clock` source as manual entries. Schedule control, idempotency, and the link to the closing event are stored in separate tables; screens, reports, and CSV exports do not add an automation label.
- Changing or disabling a schedule does not recalculate previous records. A pending clock-out can only close its linked interval if it remains intact; respect manual interventions, corrections, and voided records.
- Corrections retain previous values, new values, author, and reason, and remain visible to the employee even when moving a record to another month.
- Issued reports are frozen versions. Later corrections require a new version; do not recalculate old reports. Review the breakdown of hours explicitly, and record the actual delivery date and method.
- Do not routinely delete employment records or delete them when disabling an account. Preserve history and the planned four-year retention period for records; cleaning up fictional data is not a general deletion feature.
- Manual backups are encrypted, stored outside the app, and exclude passwords and authentication sessions. Being able to export does not prove recovery works: preserve the restore drill and its relationship and report checks.

## Validation and delivery

Run checks relevant to the change. `npm run check` combines the checks and does not require access to live Convex. CI uses a placeholder URL to build. For documentation-only changes, reviewing content, paths, and the diff is sufficient.

Tests for time calculations, permissions, concurrency, corrections, and reports must check meaningful behavior. Backup changes require encryption and recovery verification. For interface changes, test the affected flow at desktop and mobile sizes; mobile simulation does not prove Safari or physical phone behavior. Reload when persistence needs to be demonstrated.

When delivering work, distinguish code review, automated tests, real browser checks, CI, and deployment. State what was checked and any material limitations; do not present historical tests or capacity estimates as current verification.
