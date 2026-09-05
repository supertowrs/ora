# Ora recovery

Backups downloaded from **Informes → Copia de seguridad** (Reports → Backup in the Spanish interface) are encrypted in the browser using AES-256-GCM. The key is derived with PBKDF2-SHA256 and 600,000 iterations; each file has a random salt and IV. Store the password outside Ora. It is not sent to Convex and cannot be recovered through the application.

The backup includes the company, stores, employees, employment periods and their changes, work intervals, corrections, incidents, issued reports, weekly schedules, and their interval execution state. It excludes passwords, authentication sessions, tokens, and technical retry history. Access is recreated after restoration.

## Weekly backups

1. Generate the backup from a company computer and choose a password of at least 12 characters.
2. Confirm the download and move the file to the company's external storage location. Keep the password separately.
3. Also retain issued monthly reports and deliver the summary with payroll through the agreed channel.

Writes are briefly blocked during reading to obtain a consistent backup across tables; prefer a time outside clock-in and clock-out periods. The lock is released on completion or cancellation. If the browser closes, a Convex task releases it after ten minutes. Ora records that the backup was generated; it does not confirm that the file was successfully stored externally.

A weekly interval leaves a potential data loss window of up to seven days if the service is completely lost. If connectivity or Convex fails during clocking, note the actual time and correct the record later with a reason.

## Drill against an empty local Convex backend

The [restore-drill.mts](../shared/restore-drill.mts) script only accepts HTTP at `127.0.0.1`, `localhost`, or `::1`. The backend rejects restoration if the target already contains a company, stores, employees, or other application data. It does not delete or replace existing records.

Prepare a separate copy of the code and an empty local Convex backend in `.local/restore-workspace`. Keep its development process running and deploy the same schema and functions there. Work from that isolated directory without changing the main project's variables or its European deployment.

The local CLI stores its configuration in `.local/restore-workspace/.convex/local/default/config.json`. It contains `ports.cloud` and `adminKey`; read the key directly into memory and never print it, paste it into commands, or copy it into documentation.

With `ORA_BACKUP_PASSWORD` available in the environment through your credential manager, run this example from the Ora root directory, adjusting only the encrypted file path:

```sh
rtk proxy node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('.local/restore-workspace/.convex/local/default/config.json', 'utf8'));
if (!config.adminKey || !Number.isInteger(config.ports?.cloud)) throw new Error('Incomplete local configuration.');
if (!process.env.ORA_BACKUP_PASSWORD) throw new Error('Backup password is missing from the environment.');
const result = spawnSync(process.execPath, [
  'shared/restore-drill.mts',
  '/secure/path/ora-backup.ora.json',
  `http://127.0.0.1:${config.ports.cloud}`,
], {
  stdio: 'inherit',
  env: { ...process.env, ORA_RESTORE_ADMIN_KEY: config.adminKey },
});
process.exit(result.status ?? 1);
NODE
```

The script decrypts locally, validates the version, restores in batches, and remaps relationships. Reports are restored individually to limit reads. It then compares all documents field by field, including intervals, corrections, agreed working hours, and historical reports. Internal identifiers and technical creation timestamps are checked through the mapping table; effective times and original content are preserved. It also checks the stores assigned to each schedule interval and the relationships between schedules, employees, and time entries. Version 1 backups predating schedules remain compatible and restore without schedules.

Restored schedules retain their configuration but remain **paused**, with the next entry awaiting recalculation. This pause and the empty execution cursor are the only intentional differences accepted by the comparison. The periodic process does not generate entries or close intervals during the drill, including after restoration completes. Do not save schedule configuration in a drill that must remain inactive.

If interrupted, the script displays a `restoreId`. Add it as the fourth item in the argument list, after the URL, to resume from the last confirmed batch. An incomplete restore keeps the local target in maintenance mode and must not be considered recovered. Resuming requires exactly the same file.

Successful verification prints a Spanish message beginning **“Ensayo completo: datos, rectificaciones, jornadas e informes coinciden”**, meaning that the drill completed and data, corrections, working hours, and reports match. A nonzero exit code or any document mismatch means the drill failed. Retain the technical result without employment data or secrets.

To restore access after verification, the internal `accounts:recoverAdmin` function links a new password to a restored administrator record. Then restore other users' access through the administrator. Do not reuse old tokens or authentication sessions. To resume a schedule in the recovered service, review and explicitly save its configuration under **Empleados** (Employees). Resuming only schedules future entries; open intervals from the backup require manual review and are not automatically closed or recreated.

## Recovering the live service

This script is a local drill and rejects remote addresses. Recovering the live service requires explicitly selecting a new, empty European deployment, verifying its region and free plan, importing the same backup through internal functions, comparing documents and totals, restoring accounts, and changing the website configuration. Selecting and deploying to that new target is a separate operation; this procedure does not modify production.

Backups and local configuration contain sensitive information even when backups are encrypted. Keep them out of Git, limit access, and remove drill copies after verification while retaining any required external backups.

Technical references: [Convex export](https://docs.convex.dev/database/import-export/export), [transaction limits](https://docs.convex.dev/production/state/limits), and [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).
