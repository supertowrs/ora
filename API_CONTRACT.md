# Ora API contract

All instants are UTC milliseconds, local dates/months use Europe/Madrid. Convex IDs are generated branded types. Use `api` from `convex/_generated/api`. Authenticated public calls check live session existence; revoked sessions lose access immediately. Login: `signIn("password", { username, password, flow: "signIn" })`. No signup/reset public auth flows. Errors are ConvexError Spanish strings.

## Documents

- Employee: `_id`, `name`, `username`, `userId?:Id<users>`, `role:"admin"|"worker"`, `enabled:boolean` (login enabled; activity is periods), `createdAt`.
- Store: `_id`, `name`, `active:boolean`.
- Company: `_id`, `name`, `taxId`, `timeZone:"Europe/Madrid"`, `lastBackupAt?:number`.
- Period: `_id`, `employeeId`, `startDate:"YYYY-MM-DD"`, `endDate:string|null` (inclusive), `weeklyMinutes:number`, `partTime:boolean`, `distribution:string`.
- Session: `_id`, `employeeId`, `storeId`, `startAt`, `endAt:number|null`, `voided:boolean`, `source:"clock"|"correction"`, `createdAt`, `updatedAt`.
- Correction: `_id`, `employeeId`, `sessionId`, `before: {storeId,startAt,endAt,voided}|null`, `after:{storeId,startAt,endAt,voided}`, `reason`, `actorName`, `createdAt`.
- Incident: `_id`, `employeeId`, `date`, `kind:"forgot_start"|"forgot_end"|"offline"|"other"`, `note`, `status:"open"|"resolved"`, `resolution?:string`, `resolvedAt?:number`, `createdAt`.
- Report: `_id`, `employeeId`, `month`, `version`, `issuedAt`, `snapshot` (see reports), `deliveredAt?:number`, `deliveryMethod?:string`.

## Worker `api.app`

- `me({}) query -> Employee|null` (null signed out/invalid account).
- `overview({date?:"YYYY-MM-DD"}) query -> {employee,stores:Store[],openSession:Session|null,active:boolean,serverNow:number,company:Company|null}`. Pass Madrid date from server clock anchored at mount/focus, changing query date on midnight; `active` is presentation only, every punch checks server date again.
- `history({month}) query -> {sessions:Session[],corrections:Correction[],incidents:Incident[],reports:Report[],periods:Period[]}`. Month bounded, includes sessions crossing into month.
- `clock({kind:"in"|"out"|"switch",storeId?:Id<stores>,operationId:string,requestedAt:number}) ACTION -> {sessionId,at:number,kind}`. requestedAt must come from `await api.app.serverTime({})` immediately before the clock action, expiry 60s, same operationId retry safe. switch needs storeId. No client timestamp becomes time of a punch.
- `serverTime({}) ACTION -> number`: uncached server time, call immediately before clock; actions do not queue offline.
- `operation({operationId}) query -> {sessionId,at,kind}|null` for uncertain network result.
- `reportIncident({date,kind,note:string}) mutation -> Id<incidents>`.

## Admin `api.admin`

- `dashboard({}) query -> {employees:Employee[],stores:Store[],sessions:Session[],incidents:Incident[],company:Company|null}`. Sessions = all currently open, incidents = first 100 open.
- `employees({}) query -> {employees:Employee[],periods:Period[]}`.
- `records({month,employeeId?:Id<employees>,storeId?:Id<stores>}) query -> {sessions:Session[],corrections:Correction[],incidents:Incident[],employees:Employee[],stores:Store[]}`.
- `settings({}) query -> {company:Company|null,stores:Store[]}`.
- `saveSettings({name,taxId,stores:[{id:Id<stores>,name}]}) mutation -> null` (exactly two).
- `createEmployee({name,username,password,role:"worker"|"admin"}) ACTION -> Id<employees>`.
- `updateEmployee({employeeId,name,enabled:boolean}) mutation -> null` (disabled loses access; cannot disable self).
- `resetPassword({employeeId,password}) ACTION -> null` (revokes existing sessions).
- `revokeSessions({employeeId}) ACTION -> null`.
- `reauthenticate({password}) ACTION -> null` (reauthorizes sensitive actions 30min; otherwise error `Vuelve a identificarte para realizar esta acción.`).
- `savePeriod({periodId?:Id<periods>,employeeId,startDate,endDate:string|null,weeklyMinutes,partTime,distribution}) mutation -> Id<periods>` (add/edit dated history with periodChanges audit; overlapping dates rejected).
- `correctSession({sessionId?:Id<sessions>,employeeId,storeId,startAt,endAt:number|null,voided:boolean,reason}) mutation -> Id<sessions>` (create missing or correct existing; original audited; overlap rejected).
- `resolveIncident({incidentId,resolution}) mutation -> null`.

## Employee schedules `api.schedules`

- Admin only: `get({employeeId}) query -> {schedule: Schedule|null, stores:Store[]}`.
- Admin only: `save({employeeId,enabled,startDate,endDate:string|null,slots,exclusions,expectedRevision?:number}) mutation -> Id<schedules>`. Existing configurations require the revision returned when the editor opened; stale writes are rejected.
- Slot: `{id:string, weekday:number, startTime:"HH:mm", endTime:"HH:mm", endNextDay:boolean, storeId:Id<stores>}`; Monday=1, Sunday=7. Maximum six slots per day, non-overlapping across weekdays, including Sunday to Monday.
- Exclusion: `{startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD"}`, inclusive; maximum 31 ranges.
- Schedule has the configuration above, `revision`, update metadata and an internal next-entry cursor. Saving applies to future starts only. A restored configuration may have `restoredPaused:true`; explicitly saving clears this pause without replaying restored work.
- Cron and occurrence processing are internal. They do not authenticate as a worker or change the public manual clock action. They write ordinary Session documents (`source:"clock"`), with scheduler state stored separately. No additional provenance field appears in sessions, reports or CSV.

## Reports `api.reports`

- `preview({employeeId,month}) query -> ReportSnapshot`.
- `list({employeeId?:Id<employees>,month}) query -> Report[]` (worker own only).
- `issue({employeeId,month,ordinarySeconds,complementarySeconds,extraSeconds,notes:string}) mutation -> Id<reports>`; seconds sum must match closed month total; incomplete periods/open incidents must be resolved first.
- `markDelivered({reportId,deliveredAt,method}) mutation -> null`.
- Snapshot `{companyName,taxId,employeeName,username,month,stores:[{id:string,name}],sessions:Session[],corrections:Correction[],periods:Period[],days:[{date,seconds}],totalSeconds,incomplete:boolean,pendingIncidents:number,ordinarySeconds:number|null,complementarySeconds:number|null,extraSeconds:number|null,notes:string}`. Issued snapshots frozen; later correction produces next report version.

## Backup

API supplied separately by backup owner. Functional data only: no auth tables/credentials/session tokens. Download encrypted in browser, restore into isolated empty deployment, retain original IDs mapping and counts.

## Bootstrap (internal only)

`npx convex run accounts:bootstrap '{"name":"Administradora","username":"admin","password":"<generated strong password>"}'` initializes first admin + company + 2 default stores. Only when no employees exist; re-run does not overwrite anyone. Runtime vars JWT_PRIVATE_KEY, JWKS, SITE_URL; auth issuer from CONVEX_SITE_URL.
