-- Run in SSMS as a DBA on the Hub SQL instance. Read-only.
USE [test];

SELECT ORIGINAL_LOGIN() AS connected_login, DB_NAME() AS database_name,
       net_transport, encrypt_option
FROM sys.dm_exec_connections
WHERE session_id = @@SPID;

SELECT MigrationId, ProductVersion FROM dbo.__EFMigrationsHistory;

SELECT SCHEMA_NAME(schema_id) AS schema_name, name
FROM sys.tables
WHERE name LIKE N'AspNet%' OR name IN (N'__EFMigrationsHistory', N'Favorites', N'ReportEvents');

SELECT OBJECT_NAME(object_id) AS table_name, name, is_unique, filter_definition
FROM sys.indexes
WHERE OBJECT_SCHEMA_NAME(object_id) = N'dbo'
  AND (OBJECT_NAME(object_id) LIKE N'AspNet%' OR OBJECT_NAME(object_id) IN (N'Favorites', N'ReportEvents'))
  AND is_primary_key = 0 AND name IS NOT NULL;

SELECT sp.name AS login_name, dp.name AS database_user, dp.default_schema_name
FROM sys.database_principals AS dp
JOIN sys.server_principals AS sp ON sp.sid = dp.sid
WHERE dp.name = (SELECT dp2.name FROM sys.database_principals dp2 JOIN sys.server_principals sp ON sp.sid = dp2.sid WHERE sp.name = N'IIS APPPOOL\1Reports');

EXECUTE AS LOGIN = N'IIS APPPOOL\1Reports';
BEGIN TRY
    SELECT USER_NAME() AS database_user,
           IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
           IS_MEMBER('db_owner') AS db_owner;

    SELECT object_name, permission_name,
           HAS_PERMS_BY_NAME(object_name, 'OBJECT', permission_name) AS allowed
    FROM (VALUES
        ('dbo.AspNetUsers', 'SELECT'),
        ('dbo.AspNetRoles', 'SELECT'),
        ('dbo.AspNetUserRoles', 'SELECT'),
        ('dbo.AspNetUserClaims', 'SELECT'),
        ('dbo.AspNetRoleClaims', 'SELECT'),
        ('dbo.AspNetUsers', 'UPDATE'),
        ('dbo.Favorites', 'SELECT'),
        ('dbo.Favorites', 'INSERT'),
        ('dbo.Favorites', 'DELETE'),
        ('dbo.ReportEvents', 'SELECT'),
        ('dbo.ReportEvents', 'INSERT'),
        -- People administration (scripts/create-people-directory.sql).
        ('dbo.AspNetUsers', 'INSERT'),
        ('dbo.Departments', 'SELECT'),
        ('dbo.Departments', 'INSERT'),
        ('dbo.Departments', 'UPDATE'),
        ('dbo.Departments', 'DELETE'),
        ('dbo.UserProfiles', 'SELECT'),
        ('dbo.UserProfiles', 'INSERT'),
        ('dbo.UserProfiles', 'UPDATE'),
        -- Report access (scripts/create-department-reports.sql).
        ('dbo.DepartmentReports', 'SELECT'),
        ('dbo.DepartmentReports', 'INSERT'),
        ('dbo.DepartmentReports', 'DELETE')
    ) AS required(object_name, permission_name);
END TRY
BEGIN CATCH
    REVERT;
    THROW;
END CATCH;
REVERT;
