import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Leads table — stores every Facebook lead ad submission.
 * Status lifecycle: pending → called → booked | no-answer
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  /** Lead's full name from the Facebook form */
  name: varchar("name", { length: 255 }),
  /** Lead's phone number in E.164 format */
  phone: varchar("phone", { length: 32 }),
  /** Lead's email address */
  email: varchar("email", { length: 320 }),
  /** Facebook leadgen_id for deduplication */
  facebookLeadId: varchar("facebookLeadId", { length: 64 }).unique(),
  /** Facebook form_id */
  facebookFormId: varchar("facebookFormId", { length: 64 }),
  /** Facebook page_id */
  facebookPageId: varchar("facebookPageId", { length: 64 }),
  /** Current call status */
  status: mysqlEnum("status", ["pending", "called", "booked", "no-answer"]).default("pending").notNull(),
  /** Bland.ai call_id returned when the call is dispatched */
  blandCallId: varchar("blandCallId", { length: 128 }),
  /** Calendly booking URL if a demo was booked */
  calendlyBookingUrl: varchar("calendlyBookingUrl", { length: 512 }),
  /** Calendly event UUID if already booked before call */
  calendlyEventId: varchar("calendlyEventId", { length: 128 }),
  /** Whether the lead already had a Calendly booking before the call */
  hadExistingBooking: int("hadExistingBooking").default(0),
  /** Timestamp when the call was scheduled (5 min after lead creation) */
  callScheduledAt: timestamp("callScheduledAt"),
  /** Timestamp when the call was actually placed */
  calledAt: timestamp("calledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Call logs table — stores Bland.ai call outcomes and transcripts.
 */
export const callLogs = mysqlTable("call_logs", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  /** Bland.ai call_id */
  blandCallId: varchar("blandCallId", { length: 128 }).notNull(),
  /** Call outcome status */
  status: mysqlEnum("status", ["pending", "called", "booked", "no-answer"]).default("pending").notNull(),
  /** Full call transcript as JSON string */
  transcript: text("transcript"),
  /** Recording URL from Bland.ai */
  recordingUrl: varchar("recordingUrl", { length: 512 }),
  /** Bland.ai call outcome/disposition */
  outcome: varchar("outcome", { length: 255 }),
  /** Duration in seconds */
  durationSeconds: int("durationSeconds"),
  /** Calendly booking URL confirmed during the call */
  calendlyBookingUrl: varchar("calendlyBookingUrl", { length: 512 }),
  /** Raw post-call webhook payload */
  rawPayload: text("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = typeof callLogs.$inferInsert;

/**
 * Settings table — stores provisioned Bland.ai phone number and other config.
 */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
