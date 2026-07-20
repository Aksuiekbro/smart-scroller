# SmartScroller Privacy

SmartScroller processes feed text locally in the browser to decide whether an
item matches the user's topics or contains low-signal patterns. Automatic feed
filtering does not send post text, URLs, author names, browsing history, or
media to a developer-controlled server.

The extension stores settings in browser extension storage. It stores only
bounded local feedback aggregates, one-way author keys for explicit allow rules,
and aggregate decision statistics. It does not store raw post bodies by
default. A user can explicitly paste text into the companion analyzer; that
text is processed locally and is not transmitted by the current build.

The extension requests host access only for sites the user enables. It uses that
access to read visible feed metadata and add reversible labels or blur overlays.
It does not click like, comment, share, report, follow, or “not interested”
controls.

The current build has no fact-check provider configured. A future user-triggered
provider must disclose exactly what selected claims are transmitted and must not
retain them for unrelated purposes.

To remove locally stored settings, feedback, and statistics, remove the
extension from the browser or clear its extension storage.
