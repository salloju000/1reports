-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045), AFTER create-people-directory.sql.
-- Creates department report collections (dbo.DepartmentReports), adds the Estimation department unless one
-- already exists, records the migration, and grants the 1Reports app pool what Report access needs.
-- Safe to run more than once. Generated from migration 20261118093903_DepartmentReports.
USE [testIdentity];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118093903_DepartmentReports'
)
BEGIN
    CREATE TABLE [DepartmentReports] (
        [DepartmentId] uniqueidentifier NOT NULL,
        [ReportId] nvarchar(64) NOT NULL,
        [AssignedAt] datetimeoffset NOT NULL,
        [AssignedBy] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_DepartmentReports] PRIMARY KEY ([DepartmentId], [ReportId]),
        CONSTRAINT [FK_DepartmentReports_Departments_DepartmentId] FOREIGN KEY ([DepartmentId]) REFERENCES [Departments] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118093903_DepartmentReports'
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM [Departments] WHERE [Name] = N'Estimation')
        INSERT INTO [Departments] ([Id], [CreatedAt], [Description], [Name])
        VALUES ('d3a1e0f0-0000-4000-8000-000000000018', '2026-11-18T00:00:00.0000000+00:00',
            N'Job costing, quotations and material estimates.', N'Estimation');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118093903_DepartmentReports'
)
BEGIN
    CREATE INDEX [IX_DepartmentReports_ReportId] ON [DepartmentReports] ([ReportId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118093903_DepartmentReports'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261118093903_DepartmentReports', N'10.0.14');
END;

COMMIT;
GO

GO

DECLARE @user sysname = (
    SELECT dp.name
    FROM sys.database_principals AS dp
    JOIN sys.server_principals AS sp ON sp.sid = dp.sid
    WHERE sp.name = N'IIS APPPOOL\1Reports');
IF @user IS NULL
    THROW 50000, 'IIS APPPOOL\1Reports has no user in testIdentity.', 1;

DECLARE @sql nvarchar(max) =
    N'GRANT SELECT, INSERT, DELETE ON dbo.DepartmentReports TO ' + QUOTENAME(@user) + N';';
EXEC (@sql);
SELECT @user AS granted_to;
