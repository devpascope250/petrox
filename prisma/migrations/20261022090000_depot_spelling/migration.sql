-- "Deport" was a misspelling of "depot" in what the interface shows. The codes
-- stay as they are — routes, role grants and the frontend's module registry are
-- all written against `DEPORTS` and `deports.*` — so only the names people read
-- are corrected here.
UPDATE `Module` SET `name` = 'Depots' WHERE `code` = 'DEPORTS' AND `name` = 'Deports';

UPDATE `Permission`
SET `name` = REPLACE(`name`, 'Deports', 'Depots'),
    `description` = REPLACE(`description`, 'Deports', 'Depots')
WHERE `code` LIKE 'deports.%';
