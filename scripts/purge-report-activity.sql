-- Run in the migrated Hub identity database under its maintenance identity.
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ReportEvents', N'U') IS NULL
    THROW 50000, 'Select the migrated Hub identity database before running this task.', 1;

DECLARE @cutoff datetimeoffset = DATEADD(day, -90, SYSUTCDATETIME());
DECLARE @deleted int = 1;

WHILE @deleted > 0
BEGIN
    DELETE TOP (1000) FROM dbo.ReportEvents WHERE [At] < @cutoff;
    SET @deleted = @@ROWCOUNT;
END;
