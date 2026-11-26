-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045), AFTER create-department-reports.sql.
-- Adds per-person display preferences to dbo.UserProfiles (Settings saves them so they follow people between
-- browsers) and records the migration. The app pool already has SELECT, INSERT and UPDATE on dbo.UserProfiles.
-- Safe to run more than once. Generated from migration 20261118100719_UserPreferences.
USE [testIdentity];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118100719_UserPreferences'
)
BEGIN
    ALTER TABLE [UserProfiles] ADD [Density] nvarchar(16) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118100719_UserPreferences'
)
BEGIN
    ALTER TABLE [UserProfiles] ADD [PreferredView] nvarchar(16) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118100719_UserPreferences'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261118100719_UserPreferences', N'10.0.14');
END;

COMMIT;
GO

