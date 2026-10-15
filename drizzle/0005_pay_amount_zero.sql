-- Until now a pay amount of 0 meant "not set" and the program default was billed instead.
-- From now 0 means "this member pays nothing", so old zeros become the program default (what they were billed).
UPDATE "members" m SET "pay_amount" = COALESCE(NULLIF(p."default_pay_amount", 0), 200)
FROM "programs" p WHERE p."id" = m."program_id" AND m."pay_amount" = 0;
