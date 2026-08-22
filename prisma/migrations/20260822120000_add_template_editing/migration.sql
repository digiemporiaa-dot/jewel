-- Operator-editable email copy.
--
-- MessageTemplate already existed but was only read for one campaign. These
-- columns make it a first-class, admin-managed override of the built-in copy:
--   bodyText     — optional plain-text alternative
--   lastEditedBy — staff user id of the last editor, for the audit trail.
--
-- lastEditedBy is deliberately NOT a foreign key. The template must outlive the
-- staff member who wrote it; a cascade or a restrict here would either delete
-- live customer-facing copy or block removing a leaver.

ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "bodyText" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "lastEditedBy" TEXT;
