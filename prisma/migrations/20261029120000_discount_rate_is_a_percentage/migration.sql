-- A discount rate is now a **percentage of what the sale is worth**, where it
-- used to be an amount off each litre.
--
-- The figures themselves are not touched, and nothing is deleted: a rate of 30
-- francs a litre cannot be turned into a percentage, because what share of a
-- sale it came to depended on the pump price of the day. Only a human knows
-- what was negotiated.
--
-- What this does instead is **switch off every discount written under the old
-- meaning**, so none of them prices a sale as a percentage it never meant. A
-- rate of 400 (francs a litre, once) would otherwise read as 400% and give the
-- fuel away. Each one must be entered again as a percentage — the old row is
-- still there to read the terms off.
--
-- Sales already recorded keep their own `discountRate` and `discountAmount`, so
-- what a customer was charged is unchanged. See [[snapshot-not-reference]].
--
-- The cutoff is this migration's own date, written out rather than `NOW()`, so
-- running it twice cannot switch off a percentage entered since.

UPDATE `Discount`
  SET `status` = 'inactive'
  WHERE `status` = 'active' AND `createdAt` < '2026-10-29 12:00:00';

UPDATE `RangingDiscount`
  SET `status` = 'inactive'
  WHERE `status` = 'active' AND `createdAt` < '2026-10-29 12:00:00';
