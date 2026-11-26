-- Shows what SQL a Crystal report run sends to its database, to find why a run is slow.
-- Read-only (dynamic management views; needs VIEW SERVER STATE). Run it in SSMS against the
-- report's database server while the report is running in 1Reports, and again just after.

-- 1. What is running right now: one row per active query from the Crystal worker.
SELECT
    r.session_id,
    s.host_name,
    s.program_name,
    DB_NAME(r.database_id)              AS database_name,
    r.status,
    r.total_elapsed_time / 1000         AS elapsed_s,
    r.wait_type,
    r.wait_time / 1000                  AS wait_s,
    r.blocking_session_id,
    r.logical_reads,
    SUBSTRING(t.text, r.statement_start_offset / 2 + 1,
        (CASE WHEN r.statement_end_offset = -1 THEN DATALENGTH(t.text)
              ELSE r.statement_end_offset END - r.statement_start_offset) / 2 + 1) AS running_statement
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id <> @@SPID
  AND s.is_user_process = 1
ORDER BY r.total_elapsed_time DESC;

-- 2. Every statement run in the last 10 minutes, most total time first. A statement with a high
--    execution_count is one Crystal repeats for every row (a subreport); a statement with no
--    filter on the estimate/job code reads the whole table.
SELECT TOP (40)
    qs.execution_count,
    qs.total_elapsed_time / 1000                         AS total_ms,
    qs.total_elapsed_time / 1000 / qs.execution_count    AS avg_ms,
    qs.total_logical_reads,
    qs.total_rows,
    qs.last_execution_time,
    SUBSTRING(t.text, qs.statement_start_offset / 2 + 1,
        (CASE WHEN qs.statement_end_offset = -1 THEN DATALENGTH(t.text)
              ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2 + 1) AS statement_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
WHERE qs.last_execution_time > DATEADD(MINUTE, -10, GETDATE())
  AND t.text NOT LIKE '%dm_exec_query_stats%'
ORDER BY qs.total_elapsed_time DESC;
