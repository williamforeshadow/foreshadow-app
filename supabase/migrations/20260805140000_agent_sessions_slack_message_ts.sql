-- Record which Slack message each stored turn corresponds to.
--
-- The thread reader (src/slack/thread.ts) used to drop every bot-authored
-- message, on the assumption that stored memory already covered what the agent
-- said. That holds for the agent's own replies and nothing else — the bot also
-- posts from paths that never touch ai_chat_messages:
--
--   * automations      (src/server/automations/run.ts, runSchedule.ts) — channel
--                      root posts like assignment cards and the daily outlook
--   * notifications    (src/server/notifications/notify.ts) — DM cards, landing
--                      in the same DM channel as the agent conversation
--
-- So someone could reply in a thread under an assignment card, @-mention the
-- bot, and the bot would see "can you reschedule this one?" without being able
-- to see the card being pointed at: the reader filtered it (bot_id set) and
-- stored memory never had it.
--
-- With a message ts on each stored row, the reader can filter on what is
-- ACTUALLY already in the replayed history instead of using "bot-authored" as a
-- proxy for it. That fixes the blind spot, and also drops the duplicate copy of
-- the user's earlier mention that history and the reader were both feeding in.
--
-- Nullable and unbackfilled on purpose: existing rows predate the column, and a
-- null simply means "not known to be in the thread", which is the safe default
-- (the reader may re-supply that message, never hide one).

begin;

alter table public.ai_chat_messages
  add column if not exists slack_message_ts text;

commit;
