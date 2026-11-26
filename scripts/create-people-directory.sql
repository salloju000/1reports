-- Run in SSMS as a DBA on the Hub SQL instance (server WIN-4IIIIVPF045).
-- Creates the people directory (departments, seeded for flexible packaging, and user profiles),
-- records the migration, and grants the 1Reports app pool what People administration needs.
-- Safe to run more than once. Generated from migration 20261118074609_Departments.
USE [testIdentity];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    CREATE TABLE [Departments] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(100) NOT NULL,
        [Description] nvarchar(300) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Departments] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    CREATE TABLE [UserProfiles] (
        [UserId] nvarchar(450) NOT NULL,
        [FullName] nvarchar(200) NOT NULL,
        [DepartmentId] uniqueidentifier NULL,
        CONSTRAINT [PK_UserProfiles] PRIMARY KEY ([UserId]),
        CONSTRAINT [FK_UserProfiles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_UserProfiles_Departments_DepartmentId] FOREIGN KEY ([DepartmentId]) REFERENCES [Departments] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Id', N'CreatedAt', N'Description', N'Name') AND [object_id] = OBJECT_ID(N'[Departments]'))
        SET IDENTITY_INSERT [Departments] ON;
    EXEC(N'INSERT INTO [Departments] ([Id], [CreatedAt], [Description], [Name])
    VALUES (''d3a1e0f0-0000-4000-8000-000000000001'', ''2026-11-18T00:00:00.0000000+00:00'', N''Plant leadership and general management.'', N''Management''),
    (''d3a1e0f0-0000-4000-8000-000000000002'', ''2026-11-18T00:00:00.0000000+00:00'', N''Enquiries, orders, artwork approvals and customer communication.'', N''Sales & Customer Service''),
    (''d3a1e0f0-0000-4000-8000-000000000003'', ''2026-11-18T00:00:00.0000000+00:00'', N''Job planning, scheduling and machine loading.'', N''Planning & Production Control''),
    (''d3a1e0f0-0000-4000-8000-000000000004'', ''2026-11-18T00:00:00.0000000+00:00'', N''Artwork, colour separation, plates and gravure cylinders.'', N''Pre-press & Cylinders''),
    (''d3a1e0f0-0000-4000-8000-000000000005'', ''2026-11-18T00:00:00.0000000+00:00'', N''Blown and cast film extrusion.'', N''Extrusion''),
    (''d3a1e0f0-0000-4000-8000-000000000006'', ''2026-11-18T00:00:00.0000000+00:00'', N''Rotogravure and flexographic printing.'', N''Printing''),
    (''d3a1e0f0-0000-4000-8000-000000000007'', ''2026-11-18T00:00:00.0000000+00:00'', N''Solvent-based and solventless lamination.'', N''Lamination''),
    (''d3a1e0f0-0000-4000-8000-000000000008'', ''2026-11-18T00:00:00.0000000+00:00'', N''Slitting, rewinding and roll finishing.'', N''Slitting & Rewinding''),
    (''d3a1e0f0-0000-4000-8000-000000000009'', ''2026-11-18T00:00:00.0000000+00:00'', N''Pouch, bag and sleeve conversion.'', N''Pouching & Bag Making''),
    (''d3a1e0f0-0000-4000-8000-000000000010'', ''2026-11-18T00:00:00.0000000+00:00'', N''Incoming, in-process and final inspection; lab testing.'', N''Quality Assurance''),
    (''d3a1e0f0-0000-4000-8000-000000000011'', ''2026-11-18T00:00:00.0000000+00:00'', N''Raw materials, inks, adhesives, WIP and finished goods.'', N''Stores & Inventory''),
    (''d3a1e0f0-0000-4000-8000-000000000012'', ''2026-11-18T00:00:00.0000000+00:00'', N''Packing, labelling and shipments.'', N''Dispatch & Logistics''),
    (''d3a1e0f0-0000-4000-8000-000000000013'', ''2026-11-18T00:00:00.0000000+00:00'', N''Procurement of substrates, inks, adhesives and spares.'', N''Purchase''),
    (''d3a1e0f0-0000-4000-8000-000000000014'', ''2026-11-18T00:00:00.0000000+00:00'', N''Machine maintenance, utilities and engineering.'', N''Maintenance & Utilities''),
    (''d3a1e0f0-0000-4000-8000-000000000015'', ''2026-11-18T00:00:00.0000000+00:00'', N''Costing, billing and accounts.'', N''Accounts & Finance''),
    (''d3a1e0f0-0000-4000-8000-000000000016'', ''2026-11-18T00:00:00.0000000+00:00'', N''People, payroll and plant administration.'', N''HR & Administration''),
    (''d3a1e0f0-0000-4000-8000-000000000017'', ''2026-11-18T00:00:00.0000000+00:00'', N''ERP, reports and IT infrastructure.'', N''IT & Systems'')');
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Id', N'CreatedAt', N'Description', N'Name') AND [object_id] = OBJECT_ID(N'[Departments]'))
        SET IDENTITY_INSERT [Departments] OFF;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Departments_Name] ON [Departments] ([Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    CREATE INDEX [IX_UserProfiles_DepartmentId] ON [UserProfiles] ([DepartmentId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261118074609_Departments'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261118074609_Departments', N'10.0.14');
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
    N'GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Departments TO ' + QUOTENAME(@user) + N';' +
    N'GRANT SELECT, INSERT, UPDATE ON dbo.UserProfiles TO ' + QUOTENAME(@user) + N';' +
    -- Administrators create accounts from the People page.
    N'GRANT INSERT ON dbo.AspNetUsers TO ' + QUOTENAME(@user) + N';';
EXEC (@sql);
SELECT @user AS granted_to;
