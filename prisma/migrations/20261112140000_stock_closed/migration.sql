-- A depot batch can be retired.
--
-- Litres leave a batch when a trip's T1 is recorded, at 20 °C, while the batch
-- itself is in ambient litres off the bill of lading. The two do not meet
-- exactly — fuel contracts as it cools — so the last trip off a batch leaves a
-- remainder of roughly 0.8% (diesel) to 1.2% (petrol) per 10 °C above 20.
-- That residue is not loadable fuel, and `closed` is how somebody says so.
--
-- The value is **appended**: MySQL stores an enum by index, so inserting one
-- would silently change the meaning of every row already stored.
--
-- Purely additive. No existing row changes.

ALTER TABLE `Stock`
  MODIFY `status` ENUM('awaiting', 'cancelled', 'returned', 'received', 'closed')
  NOT NULL DEFAULT 'awaiting';
