// MGSF v2 — PostgreSQL schema (Drizzle ORM). Replaces Firestore users/{adminUid}/...
//
// Ids are text so Firestore document ids are kept as-is during migration
// (closingMemberId / memberId / agentId references keep working).
// New rows get a random UUID.
import { randomUUID } from "node:crypto";
import {
  pgTable, pgEnum, text, integer, boolean, date, timestamp, jsonb, index, uniqueIndex, numeric,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const str = (name) => text(name).notNull().default("");
const json = (name, def) => jsonb(name).notNull().default(def);
// Business dates (join date, closing date …) are plain DATEs, returned as "YYYY-MM-DD" strings.
const day = (name) => date(name, { mode: "string" });

export const roleEnum = pgEnum("role", ["owner", "admin", "agent", "member"]);
export const memberStatusEnum = pgEnum("member_status", ["pending", "accepted", "rejected", "removed", "closed"]);
export const dueStatusEnum = pgEnum("due_status", ["pending", "partial", "paid"]);

// ─── Trust (old users/{adminUid} + organizations/trustInfo, contact, policies) ──
export const admins = pgTable("admins", {
  id: id(),
  displayName: str("display_name"),
  email: text("email").notNull().unique(),
  phone: str("phone"),
  trustInfo: json("trust_info", {}),
  contact: json("contact", {}),
  policies: json("policies", {}),
  extra: json("extra", {}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Login accounts (replaces Firebase Auth) ───────────────────────────────
export const accounts = pgTable("accounts", {
  id: id(),
  role: roleEnum("role").notNull(),
  loginId: text("login_id").notNull().unique(), // admin/agent: email (lowercase), member: registration number (lowercase)
  email: text("email"),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  displayName: str("display_name"),
  adminId: text("admin_id").references(() => admins.id, { onDelete: "cascade" }), // trust; null for owner
  agentId: text("agent_id").unique(),
  memberId: text("member_id").unique(),
  // staff user of a trust: role 'admin' + a custom role. NULL on an admin login = super admin (all access)
  roleId: text("role_id"),
  active: boolean("active").notNull().default(true),
  pushToken: text("push_token"), // Expo push token
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("accounts_admin_idx").on(t.adminId)]);

export const sessions = pgTable("sessions", {
  id: id(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  userAgent: str("user_agent"),
  ip: str("ip"),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("sessions_account_idx").on(t.accountId)]);

// OTPs live in the DB (old code kept them in memory → broke on serverless)
export const otps = pgTable("otps", {
  id: id(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull().default("login"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("otps_email_idx").on(t.email, t.purpose)]);

export const agents = pgTable("agents", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  agentCode: str("agent_code"),
  email: str("email"),
  phone: str("phone"),
  address: str("address"),
  city: str("city"),
  state: str("state"),
  pinCode: str("pin_code"),
  photoUrl: str("photo_url"),
  signatureUrl: str("signature_url"),
  documentUrls: json("document_urls", []),
  dateJoin: day("date_join"),
  status: text("status").notNull().default("active"),
  active: boolean("active").notNull().default(true),
  deleted: boolean("deleted").notNull().default(false),
  extra: json("extra", {}),
  // { enabled, joinFees: { enabled, type: "percentage"|"fixed", value }, closing: { … } } — see src/lib/commission.js
  commission: json("commission", {}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("agents_admin_idx").on(t.adminId)]);

// ─── Program (yojna) ───────────────────────────────────────────────────────
export const programs = pgTable("programs", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hiname: str("hiname"),
  guname: str("guname"),
  noteLine: str("note_line"),
  about: str("about"),
  category: str("category"),
  isSelected: boolean("is_selected").notNull().default(false),
  ageGroups: json("age_groups", []), // [{id,startAge,endAge,payAmount,joinFees}]
  locationGroups: json("location_groups", []), // [{id,groupName,location}]
  regPrefix: text("reg_prefix").notNull().default("R"),
  regMode: text("reg_mode").notNull().default("random"), // random | series
  regDigits: integer("reg_digits").notNull().default(6),
  regStartNo: integer("reg_start_no").notNull().default(1),
  regCounter: integer("reg_counter").notNull().default(0),
  memberCounter: integer("member_counter").notNull().default(0), // for memberNumber only; live counts come from SQL
  defaultPayAmount: integer("default_pay_amount").notNull().default(200),
  dueDays: integer("due_days").notNull().default(45), // closing payment due = closing date + dueDays
  // false = old behaviour: a newly accepted member only owes closings dated today or later
  // true  = he owes every closing dated on/after his join date
  syncPastClosingsOnAccept: boolean("sync_past_closings_on_accept").notNull().default(false),
  extra: json("extra", {}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("programs_admin_idx").on(t.adminId)]);

export const closingGroups = pgTable("closing_groups", {
  id: id(),
  programId: text("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("closing_groups_program_idx").on(t.programId)]);

export const members = pgTable("members", {
  id: id(),
  programId: text("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  registrationNumber: str("registration_number"),
  applicationNumber: str("application_number"),
  memberNumber: integer("member_number").notNull().default(0),

  status: memberStatusEnum("status").notNull().default("pending"),
  active: boolean("active").notNull().default(true),
  deleted: boolean("deleted").notNull().default(false),
  blocked: boolean("blocked").notNull().default(false),

  displayName: str("display_name"),
  fatherName: str("father_name"),
  gender: str("gender"),
  gotra: str("gotra"),
  jati: str("jati"),
  guardian: str("guardian"), // वारिसदार
  guardianRelation: str("guardian_relation"),
  guardianAadharNo: str("guardian_aadhar_no"),
  phone: str("phone"),
  phoneAlt: str("phone_alt"),
  aadhaarNo: str("aadhaar_no"),
  birthDate: day("birth_date"),
  currentAddress: str("current_address"),
  village: str("village"),
  district: str("district"),
  state: str("state"),
  pinCode: str("pin_code"),

  ageGroup: str("age_group"),
  ageGroupRange: str("age_group_range"),
  memberGroup: str("member_group"),
  locationGroup: str("location_group"),
  locationGroupId: str("location_group_id"),
  closingMonths: integer("closing_months").notNull().default(0),
  membershipClosingDate: day("membership_closing_date"),

  dateJoin: day("date_join").notNull(),
  payAmount: integer("pay_amount").notNull().default(200),

  joinFees: integer("join_fees").notNull().default(0),
  joinFeesDone: boolean("join_fees_done").notNull().default(false),
  joinFeesTxnId: str("join_fees_txn_id"),
  joinFeesPaymentType: str("join_fees_payment_type"),
  joinFeesPaidAmount: integer("join_fees_paid_amount").notNull().default(0),
  joinFeesRemainingAmount: integer("join_fees_remaining_amount").notNull().default(0),

  addedBy: text("added_by").notNull().default("admin"), // admin | agent
  addedByName: text("added_by_name").notNull().default("Admin"),

  photoUrl: str("photo_url"),
  extraImageUrl: str("extra_image_url"),
  documentFrontUrl: str("document_front_url"),
  documentBackUrl: str("document_back_url"),
  guardianDocumentUrl: str("guardian_document_url"),
  guardianDocumentBackUrl: str("guardian_document_back_url"),
  extraDetails: json("extra_details", []),
  note: str("note"),

  // ── closing (marriage). closingDate NULL = not closed ──
  closingDate: day("closing_date"),
  closingAt: timestamp("closing_at", { withTimezone: true }),
  closingGroupId: text("closing_group_id").references(() => closingGroups.id, { onDelete: "set null" }),
  closingNotes: str("closing_notes"),
  invitationCardUrl: str("invitation_card_url"),
  pdfData: jsonb("pdf_data"),

  extra: json("extra", {}), // any Firestore field not mapped above
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("members_program_status_idx").on(t.programId, t.status),
  index("members_program_agent_idx").on(t.programId, t.agentId),
  index("members_program_closing_idx").on(t.programId, t.closingDate),
  index("members_program_appno_idx").on(t.programId, t.applicationNumber),
  index("members_program_aadhaar_idx").on(t.programId, t.aadhaarNo),
  index("members_regno_idx").on(t.registrationNumber),
]);

// ─── Due = old payment_pending: what one payer owes for one closing ───────
export const dues = pgTable("dues", {
  id: id(),
  programId: text("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  closingMemberId: text("closing_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  payerMemberId: text("payer_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(), // payer's payAmount when the due was created
  paidAmount: integer("paid_amount").notNull().default(0),
  status: dueStatusEnum("status").notNull().default("pending"),
  dueDate: day("due_date"),
  addedManually: boolean("added_manually").notNull().default(false),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidDate: day("paid_date"), // business date it became fully paid (late / on-time reports)
  paymentMethod: str("payment_method"),
  onlineReference: str("online_reference"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("dues_closing_payer_uq").on(t.closingMemberId, t.payerMemberId),
  index("dues_program_status_idx").on(t.programId, t.status),
  index("dues_payer_status_idx").on(t.payerMemberId, t.status),
  // + covering indexes dues_payer_cover_idx / dues_closing_cover_idx (INCLUDE status, amount, paid_amount)
  //   are created in drizzle/0002_performance_indexes.sql
]);

// One row per closing paid (same as the old transactions collection)
export const transactions = pgTable("transactions", {
  id: id(),
  programId: text("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  transactionNumber: text("transaction_number").notNull().unique(),
  batchId: text("batch_id").notNull(),
  sequenceNumber: integer("sequence_number").notNull().default(1),
  payerMemberId: text("payer_member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  closingMemberId: text("closing_member_id").references(() => members.id, { onDelete: "set null" }),
  dueId: text("due_id").references(() => dues.id, { onDelete: "set null" }),
  amount: integer("amount").notNull(),
  isFullPayment: boolean("is_full_payment").notNull().default(true),
  paymentMethod: text("payment_method").notNull().default("cash"),
  paymentDate: day("payment_date").notNull(),
  note: str("note"),
  onlineReference: str("online_reference"),
  onlineVerified: boolean("online_verified").notNull().default(false),
  transactionType: text("transaction_type").notNull().default("marriage_payment"),
  bulkPaymentMode: str("bulk_payment_mode"),
  status: text("status").notNull().default("completed"), // completed | reversed
  createdById: str("created_by_id"),
  extra: json("extra", {}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tx_program_created_idx").on(t.programId, t.createdAt),
  index("tx_program_ref_idx").on(t.programId, t.onlineReference),
  index("tx_payer_idx").on(t.payerMemberId),
  index("tx_batch_idx").on(t.batchId),
  index("tx_due_idx").on(t.dueId),                       // FK from dues delete (revert closing)
  index("tx_closing_idx").on(t.closingMemberId),
  index("tx_program_paydate_idx").on(t.programId, t.paymentDate),
]);

// Join fee instalments (old programs/{id}/joinFeesTransactions)
export const joinFeePayments = pgTable("join_fee_payments", {
  id: id(),
  programId: text("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  paymentMode: text("payment_mode").notNull().default("cash"),
  transactionRef: str("transaction_ref"), // UPI / bank reference
  paymentDate: day("payment_date").notNull(),
  note: str("note"),
  agentId: text("agent_id"),
  createdById: str("created_by_id"),
  createdByName: str("created_by_name"),
  extra: json("extra", {}),
  createdAt: createdAt(),
}, (t) => [
  index("join_fee_member_idx").on(t.memberId),
  index("join_fee_program_idx").on(t.programId, t.paymentDate),
]);

// ─── Roles & master data (migration 0004) ──────────────────────────────────
// permissions: { members: ["view","add","edit"], … } — see src/lib/permissions.js
export const roles = pgTable("roles", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: str("description"),
  permissions: json("permissions", {}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Dropdown lists the trust maintains: state, district (parent_value = state), relation, caste, gotra …
export const masterData = pgTable("master_data", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  labelEn: str("label_en"),
  parentValue: str("parent_value"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("master_data_uq").on(t.adminId, t.type, t.parentValue, t.value),
  index("master_data_type_idx").on(t.adminId, t.type, t.sortOrder),
]);

// ─── Agent commission (migration 0003) ─────────────────────────────────────
// One row per payment that earned commission (join fee instalment or closing transaction).
// kind "reversal" = a negative row written when an already paid-out commission's payment is undone.
export const agentCommissionPayouts = pgTable("agent_commission_payouts", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  payoutNumber: text("payout_number").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull().default("cash"),
  reference: str("reference"),
  note: str("note"),
  payoutDate: day("payout_date").notNull(),
  commissionCount: integer("commission_count").notNull().default(0),
  status: text("status").notNull().default("paid"), // paid | reverted
  createdById: str("created_by_id"),
  createdByName: str("created_by_name"),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
  revertReason: str("revert_reason"),
  createdAt: createdAt(),
}, (t) => [index("commission_payout_agent_idx").on(t.agentId, t.payoutDate)]);

export const agentCommissions = pgTable("agent_commissions", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  programId: text("program_id").references(() => programs.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
  closingMemberId: text("closing_member_id").references(() => members.id, { onDelete: "set null" }),
  source: text("source").notNull(), // join_fees | closing
  sourceId: text("source_id").notNull(), // join_fee_payments.id | transactions.id
  kind: text("kind").notNull().default("earned"), // earned | reversal
  baseAmount: integer("base_amount").notNull(),
  rateType: text("rate_type").notNull(), // percentage | fixed
  rateValue: numeric("rate_value", { precision: 12, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | cancelled
  payoutId: text("payout_id").references(() => agentCommissionPayouts.id, { onDelete: "set null" }),
  paymentDate: day("payment_date").notNull(),
  note: str("note"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("commission_source_uq").on(t.source, t.sourceId, t.kind),
  index("commission_agent_idx").on(t.agentId, t.paymentDate),
  index("commission_agent_status_idx").on(t.agentId, t.status),
  index("commission_payout_idx").on(t.payoutId),
  index("commission_member_idx").on(t.memberId),
]);

export const notifications = pgTable("notifications", {
  id: id(),
  adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  accountId: text("account_id"), // null = for the admin panel
  title: text("title").notNull(),
  body: str("body"),
  data: json("data", {}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("notifications_admin_idx").on(t.adminId, t.createdAt),
  index("notifications_account_idx").on(t.accountId, t.createdAt),
]);

