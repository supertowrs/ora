# Ora

A time tracking application for a company with two stores. Employees clock in and out from their phones, while administrators manage people, records, and reports from a desktop.

Built with React, TypeScript, and Vite, using Convex for the backend and database, Convex Auth for username and password authentication, and Vercel for static frontend hosting.

## Features

- Clock in, clock out, and switch stores, with individual history and incident reporting.
- Manage employees, access, and employment periods with agreed working hours.
- Optional weekly schedules per employee, with split shifts and excluded dates.
- Corrections that retain the reason, author, and previous values and remain visible to the employee.
- Versioned monthly reports, printing, and CSV record downloads.
- Manual encrypted backups and a restore drill in an isolated environment.

Times are displayed in `Europe/Madrid`. The application is designed for a single company; it does not include payroll, geolocation, or offline clocking. The application interface is in Spanish; labels quoted below match the interface.

## Local development

Requires Node.js **24**, npm, and your own Convex development deployment.

```sh
npm ci
cp .env.example .env.local
```

Copy the example file only if you do not already have `.env.local`. Set `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` to your deployment's values. Variables prefixed with `VITE_` are public in the browser and must never contain secrets.

Set up authentication and synchronize the backend:

```sh
npm run setup:dev-auth
npm run dev:backend
```

These commands modify the selected deployment. Use an isolated environment for development: a backend labeled as development may still contain real data. `setup:dev-auth` preserves existing keys, generates both if neither exists, and sets `SITE_URL`; it requires a development target and rejects a deployment key in the environment. Set `ORA_SITE_URL` to use a different frontend origin.

Start the frontend in another terminal:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`.

## Checks

```sh
npm run typecheck  # TypeScript
npm test           # Automated tests
npm run build      # Production build
npm run check      # Types, tests, and build
```

Building requires `VITE_CONVEX_URL`. Tests use `convex-test` and do not require access to the live service. CI builds with a placeholder URL. To validate an installation, also check its flows against its backend and on the browsers and devices that will be used.

## Initial setup

The internal `accounts:bootstrap` function creates the first administrator account, the company, and two initial stores. It requires technical access to the deployment, a name, a username, and a password of at least 14 characters. It only works when there are no employees; public registration is disabled. Store credentials in a password manager.

From the administration interface:

1. Fill in the company details and the names of both stores.
2. Create individual accounts and employment periods, including agreed hours and effective dates.
3. Check each person's access from their phone. They can add the website to their home screen.
4. Configure a weekly schedule only for employees who should have automatic time entries.

Ending an employment period preserves access to history. Disabling an account also revokes its open authentication sessions without deleting its records.

## Usage

To clock in, select **Entrar a trabajar** and choose a store. **Salir del trabajo** closes the work interval; **Cambiar de tienda** closes one interval and opens another at the same instant. Record each part of a split shift separately: breaks are not deducted automatically.

A time entry is only confirmed once the server responds. If the connection fails, note the actual time and report the incident so it can be corrected with a reason. There is no offline clocking queue.

Enable weekly schedules under **Empleados → employee details → Fichaje automático**. They support up to six intervals per day, departures on the following day, and excluded dates. They are independent of agreed hours and do not backfill the past. The backend processes events every minute using their scheduled times; an interruption may delay their appearance. Editing or disabling a schedule does not recalculate previous records and respects manual interventions. Restored schedules remain paused until explicitly saved.

Administrators review incidents, correct records, and issue reports for completed months. Each report retains its version; a later correction requires a new one. **Registros → Descargar CSV** exports current intervals matching the filters, including open and voided intervals; it does not replace the issued monthly report. Report delivery records the actual date and delivery method.

## Backups and recovery

Periodically download an encrypted backup from **Informes** and store it outside the application, keeping its password separately. It includes employment data and reports, but not passwords or authentication sessions. The latest backup indicator confirms generation, not that the file is still available.

Recovery requires an empty, isolated target and new access credentials. See the [recovery procedure](docs/RECOVERY.md), including the local drill that checks data and relationships. Weekly backups leave a potential data loss window of up to seven days.

## Vercel deployment

`vercel.json` configures the SPA, security headers, and deployment from `main`. The [deploy-vercel.mjs](scripts/deploy-vercel.mjs) script deploys both the backend and frontend and checks the branch, Vercel environment, and Convex target.

For your own installation, adjust the allowed target in that script and configure `CONVEX_DEPLOY_KEY` as a secret available only in Vercel's **Production** environment. Set up backend authentication and its `SITE_URL` for the public frontend origin. Never share the key with previews or store it in Git.

With Git integration enabled, pushing to `main` starts deployment. Convex injects `VITE_CONVEX_URL` and runs `npm run check` before deploying functions; Vercel then publishes `dist`. Automatic deployment is disabled for other branches. Changing only the frontend URL does not migrate data or authentication.

A Vercel rollback restores the frontend, not the backend or data. Keep both compatible when deploying changes. Check the limits and terms of your chosen plans before operating an installation.

## Project structure

| Directory  | Contents                                                          |
| ---------- | ----------------------------------------------------------------- |
| `src/`     | Employee and administrator interfaces, components, and styles.    |
| `convex/`  | Data model, authentication, authorization, and backend functions. |
| `shared/`  | Time calculations, CSV, encryption, tests, and recovery tools.    |
| `scripts/` | Authentication setup and Vercel deployment.                       |
| `docs/`    | Recovery documentation.                                           |

See [AGENTS.md](AGENTS.md) for instructions on working with the code. Keep credentials, exports, and employment data out of the repository and logs; `.gitignore` and `.vercelignore` exclude local and generated files.
