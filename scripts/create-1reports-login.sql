-- Run in SSMS on the Hub SQL instance (WIN-4IIIIVPF045) as a login that can create logins.
-- Gives the 1Reports app pool's Windows account (IIS APPPOOL\1Reports) exactly the server roles,
-- database users, role memberships and explicit permissions that IIS APPPOOL\EFIReportingHubPool
-- has, in every online database. The old login is left untouched, so switching the site back to
-- EFIReportingHubPool still works.
-- Set @apply = 0 to only list the statements, 1 to run them.
DECLARE @apply bit = 0;
DECLARE @old sysname = N'IIS APPPOOL\EFIReportingHubPool', @new sysname = N'IIS APPPOOL\1Reports';
SET NOCOUNT ON;
IF SUSER_ID(@old) IS NULL THROW 50000, 'The old app pool login does not exist.', 1;

CREATE TABLE #work (db sysname NULL, stmt nvarchar(max) NOT NULL, seq int IDENTITY);

-- Server level.
IF SUSER_ID(@new) IS NULL
    INSERT #work (db, stmt) VALUES (N'master', N'CREATE LOGIN ' + QUOTENAME(@new) + N' FROM WINDOWS WITH DEFAULT_DATABASE = '
        + QUOTENAME((SELECT default_database_name FROM sys.server_principals WHERE name = @old)) + N';');
INSERT #work (db, stmt)
SELECT N'master', N'ALTER SERVER ROLE ' + QUOTENAME(r.name) + N' ADD MEMBER ' + QUOTENAME(@new) + N';'
FROM sys.server_role_members m
JOIN sys.server_principals r ON r.principal_id = m.role_principal_id
WHERE m.member_principal_id = SUSER_ID(@old);
INSERT #work (db, stmt)
SELECT N'master', REPLACE(p.state_desc, N'_WITH_GRANT_OPTION', N'') + N' ' + p.permission_name + N' TO ' + QUOTENAME(@new)
    + CASE WHEN p.state = 'W' THEN N' WITH GRANT OPTION' ELSE N'' END + N';'
FROM sys.server_permissions p
WHERE p.grantee_principal_id = SUSER_ID(@old) AND p.class = 100 AND p.permission_name <> N'CONNECT SQL';

-- Every online database the old login has a user in.
DECLARE @db sysname, @q nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1;
OPEN dbs; FETCH dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @q = N'USE ' + QUOTENAME(@db) + N';
DECLARE @olduser sysname = (SELECT dp.name FROM sys.database_principals dp JOIN sys.server_principals sp ON sp.sid = dp.sid WHERE sp.name = @old);
IF @olduser IS NOT NULL
BEGIN
    DECLARE @uid int = DATABASE_PRINCIPAL_ID(@olduser);
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals dp JOIN sys.server_principals sp ON sp.sid = dp.sid WHERE sp.name = @new)
        INSERT #work (db, stmt) VALUES (DB_NAME(), N''CREATE USER '' + QUOTENAME(@new) + N'' FOR LOGIN '' + QUOTENAME(@new) + N'';'');
    INSERT #work (db, stmt)
    SELECT DB_NAME(), N''ALTER ROLE '' + QUOTENAME(r.name) + N'' ADD MEMBER '' + QUOTENAME(@new) + N'';''
    FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
    WHERE m.member_principal_id = @uid;
    INSERT #work (db, stmt)
    SELECT DB_NAME(), REPLACE(p.state_desc, N''_WITH_GRANT_OPTION'', N'''') + N'' '' + p.permission_name
        + CASE p.class
            WHEN 0 THEN N''''
            WHEN 1 THEN N'' ON '' + QUOTENAME(OBJECT_SCHEMA_NAME(p.major_id)) + N''.'' + QUOTENAME(OBJECT_NAME(p.major_id))
                 + ISNULL(N'' ('' + QUOTENAME(c.name) + N'')'', N'''')
            WHEN 3 THEN N'' ON SCHEMA::'' + QUOTENAME(SCHEMA_NAME(p.major_id)) END
        + N'' TO '' + QUOTENAME(@new) + CASE WHEN p.state = ''W'' THEN N'' WITH GRANT OPTION'' ELSE N'''' END + N'';''
    FROM sys.database_permissions p
    LEFT JOIN sys.columns c ON p.class = 1 AND c.object_id = p.major_id AND c.column_id = p.minor_id
    WHERE p.grantee_principal_id = @uid AND p.class IN (0, 1, 3) AND NOT (p.class = 0 AND p.permission_name = N''CONNECT'');
END';
    EXEC sys.sp_executesql @q, N'@old sysname, @new sysname', @old, @new;
    FETCH dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

IF @apply = 1
BEGIN
    DECLARE @d sysname, @s nvarchar(max);
    DECLARE run CURSOR LOCAL FAST_FORWARD FOR SELECT db, stmt FROM #work ORDER BY seq;
    OPEN run; FETCH run INTO @d, @s;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @s = N'USE ' + QUOTENAME(@d) + N'; ' + @s;
        EXEC (@s);
        FETCH run INTO @d, @s;
    END
    CLOSE run; DEALLOCATE run;
END
SELECT CASE WHEN @apply = 1 THEN 'applied' ELSE 'preview only' END AS mode, db, stmt FROM #work ORDER BY seq;
DROP TABLE #work;
