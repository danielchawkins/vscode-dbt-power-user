# S9: Snowflake query identity and phases

Captured 2026-09-21 on dbt Fusion 2.0.5. The operator explicitly opted into spike S9 for the account and warehouse resolved by profile `finance_general`, target `dev`, using the profiles directory under the home directory; those identifiers are intentionally omitted from this artifact. No raw Snowflake query ids, session ids, warehouse or account identifiers, credentials, or profile contents appear in this record. No real-project query text was executed and no result rows were retained. The synthetic preview text was `select 1 as id` with a shared constant SQL comment marker on the exact-repeat pair.

The project was a temporary copy of `src/test/fixtures/single-project` outside the repository. The copy omitted `models/broken_ref.sql` and `models/child.sql` because the deliberate missing ref blocked `dbt show --inline` with `DependencyNotFound`. Launch used `--profiles-dir` pointed at the operator profiles directory, `--profile finance_general`, `--target dev`, and `--no-version-check`, so the fixture's bundled `profiles.yml` was not on the resolution path.

## Join mechanism and sample size

Timings were read from `INFORMATION_SCHEMA.QUERY_HISTORY`. Fusion did not expose a Snowflake query id on the CLI preview path, so the join used a shared constant SQL comment marker plus a bounded capture time window (`dateadd('second', -30, current_timestamp())`), excluding rows whose `query_text` references `information_schema`. Candidate preview rows were ordered by `start_time`; raw query ids and timestamps were not persisted.

## Phase timings

### Exact-repeat pair (`n = 1` per ordered row)

Two back-to-back `dbt show --inline` invocations used **identical** SQL text, including one shared constant comment marker. The history probe found exactly two candidate preview rows (history probe rows excluded).

| Order               | Arm                     | Compilation (ms) | Execution (ms) | Queue prov / repair / overload (ms) |
| ------------------- | ----------------------- | ---------------- | -------------- | ----------------------------------- |
| First matching row  | Immediate repeat (warm) | 50               | 1              | 0 / 0 / 0                           |
| Second matching row | Identical-repeat intent | 75               | 1              | 0 / 0 / 0                           |

`QUERY_HISTORY` on this capture exposed no result-reuse indicator column; the second row records identical-repeat intent and timing only, not proof that Snowflake reused a cached result.

### First after suspend attempt (partial, not measured cold)

`ALTER WAREHOUSE IF EXISTS <identifier> SUSPEND` through `dbt show --inline` succeeded on this capture (identifier taken from the in-memory profile, not recorded here). A preview ran after a five-second wait. Warehouse state at preview start was **not proven** suspended — only that a suspend statement returned success before the wait. The matched preview row shows 0 ms provisioning queue time (`n = 1`): compilation 150 ms, execution 1 ms, queue 0 / 0 / 0. **Cold provisioning was not observed.** A separate attempt on the same profile returned `invalid_state` (warehouse cannot be suspended). Candidate causes for 0 ms provisioning despite suspend success include immediate auto-resume before the preview started or provisioning completing inside the recorded window; this capture does not distinguish them.

### Reuse disabled (unavailable)

**Reuse disabled — unavailable.** `dbt show --help` (local Fusion 2.0.5) lists no `use_cached_result` flag. A separate `dbt show --inline` ran `ALTER SESSION SET USE_CACHED_RESULT = FALSE`; the subsequent preview was in a **different** session (`session_id` comparison: different). No reuse-disabled timing row is reported.

## Capability probes

**Query id from Fusion — no (`n = 1` CLI).** Checked: `dbt show --log-level debug --log-format json` on the synthetic preview. The `SQLQuery` event header reports `query_id: not available`. LSP `dbt.show` was checked in the first capture: response fields were `columns`, `data`, and `error` only; no query-id field. History timings used the marker-and-window join above, not a Fusion-supplied id.

**Cancel an in-flight CLI preview — no (`n = 1`, first capture retained).** Scope: CLI `dbt show` only; LSP cancellation unchecked. Bounded probe: `dbt show --inline "select system$wait(5)"` with `--limit 1`. Client `SIGINT` after two seconds did not shorten the run (~5 s elapsed). Client `SIGTERM` after two seconds exited the client at ~2 s, but `QUERY_HISTORY` showed the warehouse statement still completing (~5 s). No Fusion cancel subcommand exists on this path.

**Query tag through Fusion — no.** Checked: `dbt show --help` (local Fusion 2.0.5; lists `--query-id` for LakeCompute only, no query-tag flag), the `finance_general` / `dev` profile target (no `query_tag` key), and cross-session `ALTER SESSION SET QUERY_TAG` via separate `dbt show --inline` (preview in a **different** session, `tag_present: false` on the preview row). LSP tag path unchecked.

## Verdict

| S9 question                         | Answered    | Notes                                                                                     |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Exact-repeat pair with one row each | Yes         | Two identical-SQL previews; exactly two candidate rows (`n = 1` each).                    |
| Identical-repeat intent timing      | Yes         | Second row timing recorded; no reuse indicator in `QUERY_HISTORY`.                        |
| Cold / provisioning queue           | Partial     | Suspend succeeded once; provisioning 0 ms; warehouse suspended at preview start unproven. |
| Reuse-disabled arm                  | Unavailable | Different session; no timing.                                                             |
| Query id from Fusion                | Yes — no    | CLI `SQLQuery`: not available; LSP: no query-id field.                                    |
| Cancel in-flight CLI preview        | Yes — no    | CLI only (`n = 1`); LSP unchecked.                                                        |
| Query tag through Fusion            | Yes — no    | No CLI/profile mechanism; cross-session ALTER does not tag preview.                       |
| Phase 7.4 discharge                 | No          | Reuse-disabled unavailable; cold unproven; capability answers negative on checked paths.  |

## Fixture load note

With the fixture models intact, the first launch failed at parse time with `DependencyNotFound` on `missing_model`. Removing the broken-ref chain from the temporary copy was required before any warehouse preview ran. That edit applied only to the temp copy, not the repository fixture.
