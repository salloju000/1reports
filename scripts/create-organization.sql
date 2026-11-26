-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045), AFTER add-user-preferences.sql.
-- Adds dbo.Organization: the organisation name and logo administrators set under Settings > Organization,
-- shown in the workspace header. One row; the logo is a small PNG, JPEG or WebP image (512 KB at most).
-- Then grants the 1Reports app pool what it needs on the new table and records the migration.
-- Safe to run more than once. Generated from migration 20261119112002_Organization.
USE [testIdentity];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261119112002_Organization'
)
BEGIN
    CREATE TABLE [Organization] (
        [Id] int NOT NULL,
        [Name] nvarchar(100) NULL,
        [Logo] varbinary(max) NULL,
        [LogoContentType] nvarchar(32) NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [UpdatedBy] nvarchar(450) NULL,
        CONSTRAINT [PK_Organization] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261119112002_Organization'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261119112002_Organization', N'10.0.14');
END;

COMMIT;
GO

DECLARE @user sysname = (
    SELECT dp.name
    FROM sys.database_principals AS dp
    JOIN sys.server_principals AS sp ON sp.sid = dp.sid
    WHERE sp.name = N'IIS APPPOOL\1Reports');
IF @user IS NULL
    THROW 50000, 'IIS APPPOOL\1Reports has no user in testIdentity.', 1;

DECLARE @sql nvarchar(max) =
    N'GRANT SELECT, INSERT, UPDATE ON dbo.Organization TO ' + QUOTENAME(@user) + N';';
EXEC (@sql);
SELECT @user AS granted_to;

-- Verify as the app pool identity: every row should say allowed = 1.
EXECUTE AS LOGIN = N'IIS APPPOOL\1Reports';
SELECT object_name, permission_name,
       HAS_PERMS_BY_NAME(object_name, 'OBJECT', permission_name) AS allowed
FROM (VALUES
    ('dbo.Organization', 'SELECT'),
    ('dbo.Organization', 'INSERT'),
    ('dbo.Organization', 'UPDATE')
) AS required(object_name, permission_name);
REVERT;
