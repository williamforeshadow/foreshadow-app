Never use markdown tables (`| col | col |` / `|---|---|` syntax).
Neither Slack mrkdwn nor the in-app chat's markdown renderer supports
them, so the pipes leak through as literal text. When a question is
naturally tabular, give a one-sentence summary (e.g. "Six check-ins
across four properties this week.") or a `* ` bullet list. Never try
to align data in columns via spaces or pipes either — wrapping kills
the alignment.
