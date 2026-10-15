-- Speed-ups for big programs (tested with 5000 members, 500 closings, 12 lakh dues, 8 lakh payments).
-- transactions.due_id is a foreign key to dues: without this index, deleting a closing's dues
-- (revert closing) scanned all transactions once per due (6 minutes → under a second).
CREATE INDEX IF NOT EXISTS "tx_due_idx" ON "transactions" USING btree ("due_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_closing_idx" ON "transactions" USING btree ("closing_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_program_paydate_idx" ON "transactions" USING btree ("program_id","payment_date");--> statement-breakpoint
-- covering indexes: per-member and per-closing totals are read from the index alone
CREATE INDEX IF NOT EXISTS "dues_payer_cover_idx" ON "dues" USING btree ("payer_member_id") INCLUDE ("status","amount","paid_amount");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dues_closing_cover_idx" ON "dues" USING btree ("closing_member_id") INCLUDE ("status","amount","paid_amount");
