-- Attendants sign in at the pump by phone number, so it must identify one user.
-- Fails if two users already share a phone: fix those first.
CREATE UNIQUE INDEX `User_phone_key` ON `User`(`phone`);
