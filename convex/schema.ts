import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const role = v.union(v.literal('admin'), v.literal('worker'));
export const clockKind = v.union(v.literal('in'), v.literal('out'), v.literal('switch'));
export const incidentKind = v.union(
  v.literal('forgot_start'),
  v.literal('forgot_end'),
  v.literal('offline'),
  v.literal('other'),
);
export const sessionValues = v.object({
  storeId: v.id('stores'),
  startAt: v.number(),
  endAt: v.union(v.number(), v.null()),
  voided: v.boolean(),
});
export const employeeFields = {
  name: v.string(),
  username: v.string(),
  userId: v.optional(v.id('users')),
  role,
  enabled: v.boolean(),
  createdAt: v.number(),
};
export const companyFields = {
  name: v.string(),
  taxId: v.string(),
  timeZone: v.literal('Europe/Madrid'),
  lastBackupAt: v.optional(v.number()),
  maintenance: v.optional(v.string()),
};
export const storeFields = { name: v.string(), active: v.boolean() };
export const periodFields = {
  employeeId: v.id('employees'),
  startDate: v.string(),
  endDate: v.union(v.string(), v.null()),
  weeklyMinutes: v.number(),
  partTime: v.boolean(),
  distribution: v.string(),
};
export const periodChangeFields = {
  periodId: v.id('periods'),
  employeeId: v.id('employees'),
  before: v.object(periodFields),
  after: v.object(periodFields),
  actorName: v.string(),
  createdAt: v.number(),
};
export const sessionFields = {
  employeeId: v.id('employees'),
  ...sessionValues.fields,
  source: v.union(v.literal('clock'), v.literal('correction')),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const correctionFields = {
  employeeId: v.id('employees'),
  sessionId: v.id('sessions'),
  before: v.union(sessionValues, v.null()),
  after: sessionValues,
  reason: v.string(),
  actorName: v.string(),
  createdAt: v.number(),
};
export const incidentFields = {
  employeeId: v.id('employees'),
  date: v.string(),
  kind: incidentKind,
  note: v.string(),
  status: v.union(v.literal('open'), v.literal('resolved')),
  resolution: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
};
export const sessionDoc = v.object({
  ...sessionFields,
  _id: v.id('sessions'),
  _creationTime: v.number(),
});
export const correctionDoc = v.object({
  ...correctionFields,
  _id: v.id('corrections'),
  _creationTime: v.number(),
});
export const periodDoc = v.object({
  ...periodFields,
  _id: v.id('periods'),
  _creationTime: v.number(),
});
export const reportSnapshot = v.object({
  companyName: v.string(),
  taxId: v.string(),
  employeeName: v.string(),
  username: v.string(),
  month: v.string(),
  stores: v.array(v.object({ id: v.string(), name: v.string() })),
  sessions: v.array(sessionDoc),
  corrections: v.array(correctionDoc),
  periods: v.array(periodDoc),
  days: v.array(v.object({ date: v.string(), seconds: v.number() })),
  totalSeconds: v.number(),
  incomplete: v.boolean(),
  pendingIncidents: v.number(),
  ordinarySeconds: v.union(v.number(), v.null()),
  complementarySeconds: v.union(v.number(), v.null()),
  extraSeconds: v.union(v.number(), v.null()),
  notes: v.string(),
});
export const reportFields = {
  employeeId: v.id('employees'),
  month: v.string(),
  version: v.number(),
  issuedAt: v.number(),
  snapshot: reportSnapshot,
  deliveredAt: v.optional(v.number()),
  deliveryMethod: v.optional(v.string()),
};

export default defineSchema({
  ...authTables,
  company: defineTable(companyFields),
  stores: defineTable(storeFields),
  employees: defineTable(employeeFields)
    .index('by_userId', ['userId'])
    .index('by_username', ['username']),
  periods: defineTable(periodFields).index('by_employeeId_and_startDate', [
    'employeeId',
    'startDate',
  ]),
  periodChanges: defineTable(periodChangeFields).index('by_employeeId', ['employeeId']),
  sessions: defineTable(sessionFields)
    .index('by_employeeId_and_startAt', ['employeeId', 'startAt'])
    .index('by_employeeId_and_endAt', ['employeeId', 'endAt'])
    .index('by_endAt', ['endAt'])
    .index('by_startAt', ['startAt']),
  corrections: defineTable(correctionFields)
    .index('by_employeeId_and_createdAt', ['employeeId', 'createdAt'])
    .index('by_sessionId', ['sessionId'])
    .index('by_employeeId_and_before_startAt', ['employeeId', 'before.startAt'])
    .index('by_employeeId_and_after_startAt', ['employeeId', 'after.startAt'])
    .index('by_employeeId_and_before_endAt', ['employeeId', 'before.endAt'])
    .index('by_employeeId_and_after_endAt', ['employeeId', 'after.endAt']),
  incidents: defineTable(incidentFields)
    .index('by_employeeId_and_date', ['employeeId', 'date'])
    .index('by_status', ['status']),
  operations: defineTable({
    employeeId: v.id('employees'),
    operationId: v.string(),
    kind: clockKind,
    sessionId: v.id('sessions'),
    at: v.number(),
  }).index('by_employeeId_and_operationId', ['employeeId', 'operationId']),
  reports: defineTable(reportFields)
    .index('by_employeeId_and_month', ['employeeId', 'month'])
    .index('by_month', ['month']),
  sessionApprovals: defineTable({ sessionId: v.id('authSessions'), approvedAt: v.number() }).index(
    'by_sessionId',
    ['sessionId'],
  ),
  backupJobs: defineTable({
    kind: v.union(v.literal('export'), v.literal('restore')),
    status: v.union(
      v.literal('active'),
      v.literal('complete'),
      v.literal('cancelled'),
      v.literal('expired'),
    ),
    ownerEmployeeId: v.optional(v.id('employees')),
    startedAt: v.number(),
    expiresAt: v.optional(v.number()),
    sourceCreatedAt: v.optional(v.number()),
    tableIndex: v.optional(v.number()),
    expectedCounts: v.optional(v.record(v.string(), v.number())),
    counts: v.optional(v.record(v.string(), v.number())),
  }),
  restoreIds: defineTable({
    jobId: v.id('backupJobs'),
    table: v.string(),
    sourceId: v.string(),
    sourceCreationTime: v.number(),
    targetId: v.string(),
  }).index('by_jobId_and_table_and_sourceId', ['jobId', 'table', 'sourceId']),
});
