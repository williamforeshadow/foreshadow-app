-- Make properties.name the single source of truth for the denormalized
-- property_name copies carried on reservations / turnover_tasks /
-- property_templates.
--
-- Background: the schedule/Timeline groups rows by the free-text property_name
-- string, and several app paths (projects, template/automation overrides) match
-- on it too. Different writers filled it from different sources — notably the
-- Hostaway sync stamped each booking's property_name from the PMS's per-
-- reservation listingName, which drifts from properties.name — so one physical
-- property could end up with two different property_name strings and render as
-- two rows. This migration forces property_name to always equal properties.name
-- (keyed by property_id), via triggers, and backfills the existing drift.

-- 1a. Force-mirror trigger function. Unlike derive_org_id() (fill-if-empty),
-- this OVERWRITES property_name, because writers pass divergent values on
-- purpose. Rows with no property_id (general/standalone tasks) are left as-is.
CREATE OR REPLACE FUNCTION public.derive_property_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.property_id IS NOT NULL THEN
    SELECT name INTO NEW.property_name FROM properties WHERE id = NEW.property_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 1b. Rename cascade: when properties.name changes, push it to the existing
-- denormalized copies. Replaces the manual cascade previously inlined in
-- rename_property(). No infinite loop — it never re-updates properties, and the
-- children's BEFORE-UPDATE mirror re-derives the identical value.
CREATE OR REPLACE FUNCTION public.cascade_property_name_on_rename()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE reservations
       SET property_name = NEW.name
     WHERE property_id = NEW.id AND property_name IS DISTINCT FROM NEW.name;
    UPDATE turnover_tasks
       SET property_name = NEW.name
     WHERE property_id = NEW.id AND property_name IS DISTINCT FROM NEW.name;
    UPDATE property_templates
       SET property_name = NEW.name
     WHERE property_id = NEW.id AND property_name IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NEW;
END;
$function$;

-- 1c. Simplify rename_property(): the child-table cascades are now handled by
-- the trigger above. Validation + the unique-index 23505 (surfaced by the API
-- as a friendly collision message) are preserved.
CREATE OR REPLACE FUNCTION public.rename_property(p_id uuid, p_new_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  old_name TEXT;
BEGIN
  IF p_new_name IS NULL OR length(trim(p_new_name)) = 0 THEN
    RAISE EXCEPTION 'new name must be non-empty';
  END IF;

  SELECT name INTO old_name FROM properties WHERE id = p_id FOR UPDATE;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'property % not found', p_id;
  END IF;

  IF old_name = p_new_name THEN
    RETURN;
  END IF;

  -- Denormalized property_name copies cascade automatically via
  -- cascade_property_name_on_rename().
  UPDATE properties SET name = p_new_name, updated_at = NOW() WHERE id = p_id;
END;
$function$;

-- 2. Attach the mirror trigger to every table carrying a denormalized
-- property_name. BEFORE INSERT stops new drift; BEFORE UPDATE lets rows
-- self-heal. property_name is NOT NULL on reservations/property_templates, but
-- those always carry a property_id and BEFORE triggers run before the NOT NULL
-- check, so the column is always populated.
DROP TRIGGER IF EXISTS trg_mirror_property_name ON reservations;
CREATE TRIGGER trg_mirror_property_name
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION derive_property_name();

DROP TRIGGER IF EXISTS trg_mirror_property_name ON turnover_tasks;
CREATE TRIGGER trg_mirror_property_name
  BEFORE INSERT OR UPDATE ON turnover_tasks
  FOR EACH ROW EXECUTE FUNCTION derive_property_name();

DROP TRIGGER IF EXISTS trg_mirror_property_name ON property_templates;
CREATE TRIGGER trg_mirror_property_name
  BEFORE INSERT OR UPDATE ON property_templates
  FOR EACH ROW EXECUTE FUNCTION derive_property_name();

-- 3. Cascade a rename from the parent.
DROP TRIGGER IF EXISTS trg_cascade_property_name_on_rename ON properties;
CREATE TRIGGER trg_cascade_property_name_on_rename
  AFTER UPDATE OF name ON properties
  FOR EACH ROW EXECUTE FUNCTION cascade_property_name_on_rename();

-- 4. One-time backfill: collapse the existing drift so today's duplicate
-- schedule rows merge immediately. (These UPDATEs re-fire the mirror trigger
-- harmlessly — it derives the same value.)
UPDATE reservations r
   SET property_name = p.name
  FROM properties p
 WHERE r.property_id = p.id
   AND r.property_name IS DISTINCT FROM p.name;

UPDATE turnover_tasks t
   SET property_name = p.name
  FROM properties p
 WHERE t.property_id = p.id
   AND t.property_name IS DISTINCT FROM p.name;

UPDATE property_templates pt
   SET property_name = p.name
  FROM properties p
 WHERE pt.property_id = p.id
   AND pt.property_name IS DISTINCT FROM p.name;
