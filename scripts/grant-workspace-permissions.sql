-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045).
-- Grants the 1Reports app pool's database user the access the workspace endpoints need
-- (see scripts/check-identity-deployment.sql for the full expected permission list).
USE [testIdentity];

DECLARE @user sysname = (
    SELECT dp.name
    FROM sys.database_principals AS dp
    JOIN sys.server_principals AS sp ON sp.sid = dp.sid
    WHERE sp.name = N'IIS APPPOOL\1Reports');
IF @user IS NULL
    THROW 50000, 'IIS APPPOOL\1Reports has no user in testIdentity.', 1;

DECLARE @sql nvarchar(max) =
    N'GRANT SELECT, INSERT, DELETE ON dbo.Favorites TO ' + QUOTENAME(@user) + N';' +
    N'GRANT SELECT, INSERT ON dbo.ReportEvents TO ' + QUOTENAME(@user) + N';' +
    -- Saved report database logins (passwords are stored encrypted by the Hub).
    CASE WHEN OBJECT_ID(N'dbo.ReportCredentials') IS NOT NULL
         THEN N'GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ReportCredentials TO ' + QUOTENAME(@user) + N';'
         ELSE N'' END;
EXEC (@sql);
SELECT @user AS granted_to;

-- Verify as the app pool identity.
EXECUTE AS LOGIN = N'IIS APPPOOL\1Reports';
SELECT object_name, permission_name,
       HAS_PERMS_BY_NAME(object_name, 'OBJECT', permission_name) AS allowed
FROM (VALUES
    ('dbo.Favorites', 'SELECT'),
    ('dbo.Favorites', 'INSERT'),
    ('dbo.Favorites', 'DELETE'),
    ('dbo.ReportEvents', 'SELECT'),
    ('dbo.ReportEvents', 'INSERT'),
    ('dbo.ReportCredentials', 'SELECT'),
    ('dbo.ReportCredentials', 'INSERT'),
    ('dbo.ReportCredentials', 'UPDATE'),
    ('dbo.ReportCredentials', 'DELETE')
) AS required(object_name, permission_name);
REVERT;
