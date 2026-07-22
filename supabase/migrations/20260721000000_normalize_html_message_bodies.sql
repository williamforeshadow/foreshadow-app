-- Strip the HTML Hostaway wraps email-gateway messages in.
--
-- Hostaway returns a message body as HTML when it went out over the *email*
-- gateway (communicationType 'email' — direct guests) and as plain text over the
-- OTA channel gateway. Nothing downstream ever expected markup: the thread
-- renders `body` as text, so React escapes it and an operator sees a literal
-- "<p>" at the start and end of the message; the inbox preview is a substring of
-- the same string; and draftReply feeds these bodies to the concierge as
-- examples of how the host writes, which is one way HTML gets echoed back into
-- generated drafts.
--
-- Going forward normalizeMessageBody (lib/messages.ts) cleans this at the single
-- ingest mapper, so this migration is a one-time backfill of what landed before
-- that existed: 113 of 1967 outbound messages, 0 of 1712 inbound. Only three
-- tags ever appear — p (460), br (127), span (14) — with no links, emphasis, or
-- entities, though the entity decoding below is kept in step with the TS so the
-- two can't drift into disagreeing about the same body.
--
-- Structure is preserved rather than stripped: 53 of the 113 are multi-paragraph
-- and a blind tag-strip would run their paragraphs together into one line. So
-- </p> becomes a blank line and <br> a newline BEFORE the remaining tags are
-- dropped, and the trim happens last, after the newline collapse — trimming
-- first leaves the trailing blank lines that the collapse would have removed.
--
-- Idempotent: the WHERE clause matches only bodies that still contain a tag, and
-- re-running finds nothing. Safe to re-apply.

-- Shared with the preview update below; dropped at the end.
-- Written as sequential steps, in the same order as normalizeMessageBody, so the
-- two can be read side by side.
create or replace function pg_temp.strip_message_html(raw text)
returns text language plpgsql immutable as $$
declare t text := raw;
begin
  -- Block boundaries -> newlines, before any tag is dropped.
  t := regexp_replace(t, '<br\s*/?>',                E'\n',   'gi');
  t := regexp_replace(t, '</p\s*>',                  E'\n\n', 'gi');
  t := regexp_replace(t, '</(div|li|tr|h[1-6])\s*>', E'\n',   'gi');
  -- Everything else (<p>, <span>, ...) carries no text of its own.
  t := regexp_replace(t, '<[^>]*>',                  '',      'g');
  -- &amp; last so "&amp;lt;" can't decode twice into a stray "<".
  t := regexp_replace(t, '&nbsp;',                   ' ',     'gi');
  t := regexp_replace(t, '&lt;',                     '<',     'gi');
  t := regexp_replace(t, '&gt;',                     '>',     'gi');
  t := regexp_replace(t, '&quot;',                   '"',     'gi');
  t := regexp_replace(t, '&#0?39;|&apos;',           '''',    'gi');
  t := regexp_replace(t, '&amp;',                    '&',     'gi');
  -- Collapse, then trim — trimming first would leave the blank lines the
  -- collapse removes.
  t := regexp_replace(t, '[ \t]+' || E'\n',          E'\n',   'g');
  t := regexp_replace(t, E'\n{3,}',                  E'\n\n', 'g');
  return btrim(t);
end;
$$;

update public.guest_messages
   set body = pg_temp.strip_message_html(body)
 where body ~ '<[a-zA-Z/]';

-- The denormalized inbox preview is a 300-char truncation of a message body, so
-- it carries the same markup and can also be cut mid-tag. Normalized in place
-- rather than recomputed from guest_messages: the rollup that built it excludes
-- future-dated (scheduled) messages, and re-deriving here would have to restate
-- that rule and risk disagreeing with it. The extra trailing-fragment strip
-- requires a letter after the '<' so it can't eat legitimate text like "a < b".
update public.conversations
   set last_message_preview =
         btrim(regexp_replace(pg_temp.strip_message_html(last_message_preview),
                              '<\/?[a-zA-Z][^>]*$', '', ''))
 where last_message_preview ~ '<[a-zA-Z/]';

drop function pg_temp.strip_message_html(text);
