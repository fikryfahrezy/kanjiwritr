# Pairing and delivery protocol

The extension requests `POST /api/pairings` and receives an eight-character,
10-minute pairing code plus its own 256-bit device token. The writing client
consumes the code once through `POST /api/pairings/claim` and receives a
different 256-bit token. Codes are stored as keyed SHA-256 hashes; device tokens
are stored as SHA-256 hashes. Neither credentials nor delivered Japanese text
are logged.

Both clients authenticate the `/ws` upgrade with their device token. The
server resolves the token to a role and pairing before accepting the socket,
then routes `text.deliver` only from a writing client to an extension in that
pairing.
The extension acknowledges insertion with `delivery.ack`; only then does the
writing client receive `delivery.result`. Results are retained without text for
five minutes to make same-ID retries idempotent.

Clients ping every 25 seconds, reconnect with backoff, persist only their local
token, and can revoke the whole pairing through
`DELETE /api/pairings/current`. Pair-code issuance, claiming, and WebSocket
authentication are independently rate-limited per source address.
