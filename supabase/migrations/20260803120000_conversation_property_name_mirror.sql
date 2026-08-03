-- Extend the properties.name mirror to `conversations`.
--
-- 20260707130000_property_name_mirror made properties.name the single source of
-- truth for the denormalized property_name copies on reservations,
-- turnover_tasks and property_templates. `conversations` was never added, and it
-- is the one table the Hostaway message ingest writes directly: it stamped
-- property_name from properties.hostaway_name (the PMS listing title) rather
-- than properties.name. Listing titles get retitled over time and differ per
-- channel, so a single property accumulated several strings — "Onstad" appeared
-- as "5008 Onstad St", "5008 Onstad Mission Bay Park" and "Mission Bay Views &
-- Sea World Fireworks!". 289 of 327 conversations disagreed with their own
-- property's name.
--
-- The inbox header renders this string, and the message filter groups by it, so
-- one property showed up as several separate filter entries.
--
-- Same mechanism as the original migration: a BEFORE INSERT/UPDATE mirror that
-- OVERWRITES (writers pass divergent values on purpose), plus the rename
-- cascade. Rows with no property_id are left alone — an unmatched Hostaway
-- listing has no internal name to mirror, and blanking the PMS string would lose
-- the only hint of which property the thread belongs to.

begin;

-- 1. Mirror on write. derive_property_name() is unchanged and already generic
-- (it reads NEW.property_id); conversations just needs the trigger attached.
DROP TRIGGER IF EXISTS trg_mirror_property_name ON public.conversations;
CREATE TRIGGER trg_mirror_property_name
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.derive_property_name();

-- 2. Rename cascade. Renaming a property in its profile must reach conversations
-- too, or the inbox keeps the old name until the thread is next written.
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
    UPDATE conversations
       SET property_name = NEW.name
     WHERE property_id = NEW.id AND property_name IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Backfill the existing drift. Rows with a null property_id keep whatever
-- they have (see the header) — this only touches rows we can resolve.
UPDATE public.conversations c
   SET property_name = p.name
  FROM public.properties p
 WHERE p.id = c.property_id
   AND c.property_name IS DISTINCT FROM p.name;

commit;
