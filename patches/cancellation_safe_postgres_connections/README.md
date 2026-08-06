# Cancellation-Safe PostgreSQL Connections

Status: local self-hosted patch for PostgreSQL-backed deployments. Every bounded direct query,
execute, prepare, transaction operation, and query stream is owned by a cancel-on-drop guard. A
caller that drops an in-flight future or abandons a row stream poisons the checked-out connection
before it can return to the pool and dispatches PostgreSQL's protocol cancellation request through
the driver's independent cancellation transport.

## Contract

- Normal completion, including an ordinary PostgreSQL error whose response was consumed, disarms
  the guard and preserves the existing pool policy.
- Dropping the owning future or an incompletely consumed row stream marks the physical connection
  unusable before any later pool return.
- The cancellation request is best effort and never makes the interrupted connection reusable.
  Success means PostgreSQL accepted the protocol cancellation request; failure is recorded and the
  connection remains poisoned.
- The existing database timeout drops the guarded driver future, so timeout and external task
  cancellation share the same ownership rule.
- Transaction methods share the parent connection's poison state. Cancellation of prepare, query,
  execute, or commit prevents the transaction connection from re-entering the pool.
- `COPY IN` setup and the entire binary writer lifetime are guarded. A successful explicit finish
  disarms the guard; writer errors, task cancellation, or abandoning the writer poison and cancel
  the connection in addition to the driver's abort framing.

## Observability

- `convex_local_backend_postgres_cancellation_requested_total` counts locally canceled owners.
- `convex_local_backend_postgres_cancellation_terminal_total{outcome="accepted|failed"}` records
  the independent server cancellation request outcome.
- Existing poisoned-connection and pool occupancy metrics remain the authority for discard and
  replacement behavior.

Metrics contain no SQL, parameters, schema names, connection identifiers, or credentials.

## Verification

Focused unit tests prove an armed guard poisons on drop and a completed guard preserves reuse.
Production acceptance must additionally hold a PostgreSQL lock waiter, cancel the owning future,
observe the waiter disappear before releasing the blocker, confirm the original connection is not
reused, and verify cancellation and pool metrics. The test must use a disposable table or advisory
lock and must not modify application schema or data.

## Rollback

Restore the prior backend image. No schema or data rollback is required. The prior behavior may
again let canceled statements continue and may return their client to the idle pool.
