IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetRoles] (
        [Id] nvarchar(450) NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetUsers] (
        [Id] nvarchar(450) NOT NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(max) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserRoles] (
        [UserId] nvarchar(450) NOT NULL,
        [RoleId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE TABLE [AspNetUserTokens] (
        [UserId] nvarchar(450) NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    CREATE INDEX [EmailIndex] ON [AspNetUsers] ([NormalizedEmail]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261112072413_InitialHubIdentity'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261112072413_InitialHubIdentity', N'10.0.14');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261114052133_ReportWorkspace'
)
BEGIN
    CREATE TABLE [Favorites] (
        [UserId] nvarchar(450) NOT NULL,
        [ReportId] nvarchar(64) NOT NULL,
        CONSTRAINT [PK_Favorites] PRIMARY KEY ([UserId], [ReportId]),
        CONSTRAINT [FK_Favorites_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261114052133_ReportWorkspace'
)
BEGIN
    CREATE TABLE [ReportEvents] (
        [UserId] nvarchar(450) NOT NULL,
        [ReportId] nvarchar(64) NOT NULL,
        [InteractionId] uniqueidentifier NOT NULL,
        [Kind] nvarchar(20) NOT NULL,
        [At] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ReportEvents] PRIMARY KEY ([UserId], [ReportId], [InteractionId], [Kind]),
        CONSTRAINT [FK_ReportEvents_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261114052133_ReportWorkspace'
)
BEGIN
    CREATE INDEX [IX_ReportEvents_At] ON [ReportEvents] ([At]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261114052133_ReportWorkspace'
)
BEGIN
    CREATE INDEX [IX_ReportEvents_UserId_At] ON [ReportEvents] ([UserId], [At]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261114052133_ReportWorkspace'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261114052133_ReportWorkspace', N'10.0.14');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261117181214_ReportCredentials'
)
BEGIN
    CREATE TABLE [ReportCredentials] (
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
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261117181214_ReportCredentials'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261117181214_ReportCredentials', N'10.0.14');
END;

COMMIT;
GO

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

