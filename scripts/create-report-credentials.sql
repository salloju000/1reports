-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045).
-- Creates the table that holds saved report database logins (passwords are encrypted by the Hub)
-- in the Hub database, records the migration, and grants the 1Reports app pool access to it.
-- Safe to run more than once.
USE [testIdentity];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ReportCredentials', N'U') IS NULL
    CREATE TABLE dbo.ReportCredentials (
        [ConnectionId] nvarchar(16) NOT NULL,
        [Source] nvarchar(256) NOT NULL,
        [Database] nvarchar(256) NOT NULL,
        [Provider] nvarchar(128) NOT NULL,
        [Login] nvarchar(128) NOT NULL,
        [ProtectedPassword] nvarchar(max) NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [UpdatedBy] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_ReportCredentials] PRIMARY KEY ([ConnectionId])
    );

IF NOT EXISTS (SELECT 1 FROM dbo.__EFMigrationsHistory WHERE MigrationId = N'20261117181214_ReportCredentials')
    INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion)
    VALUES (N'20261117181214_ReportCredentials', N'10.0.14');

DECLARE @user sysname = (
    SELECT dp.name
    FROM sys.database_principals AS dp
    JOIN sys.server_principals AS sp ON sp.sid = dp.sid
    WHERE sp.name = N'IIS APPPOOL\1Reports');
IF @user IS NULL
    THROW 50000, 'IIS APPPOOL\1Reports has no user in testIdentity.', 1;
DECLARE @sql nvarchar(max) =
    N'GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.ReportCredentials TO ' + QUOTENAME(@user) + N';';
EXEC (@sql);

COMMIT;
GO

-- Verify: the table is in this database and the app pool can use it (all four should be 1).
SELECT DB_NAME() AS database_name, OBJECT_ID(N'dbo.ReportCredentials', N'U') AS table_id;
EXECUTE AS LOGIN = N'IIS APPPOOL\1Reports';
SELECT permission_name, HAS_PERMS_BY_NAME('dbo.ReportCredentials', 'OBJECT', permission_name) AS allowed
FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS required(permission_name);
REVERT;
