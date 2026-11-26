USE [PlantmanagerTest];
GO

CREATE OR ALTER PROCEDURE dbo.EFIHub_SrplInventoryReferenceLabel
    @PlantId int,
    @Barcode nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;

    IF @PlantId IS NULL OR @PlantId <= 0 OR NULLIF(LTRIM(RTRIM(@Barcode)), N'') IS NULL
        THROW 50001, 'A positive plant ID and a barcode are required.', 1;

    -- Preserve the Crystal report command and bind its two inputs as SQL parameters.
    SELECT
     a.AutoCountNumber,
     a.Description ACDescription,
     s.PieceWidth DimA,
     a.EquipmentTypeId,
     c.CustomerNumber,
     c.Description CustomerName,
     e.Description EmployeeName,
     e.Employee,
     f.BasisWeight,
     s.GrossWeight,
     s.CoreWeight,
    (s.GrossWeight - s.CoreWeight) AS NetWeight,
     f.Description FormDescription,
     f.FormNumber,
     f.FormLength,
     f.FormWidth,
     f.MisTask,
     j.JobNumber,
     j.Description JobDescription,
     pd.Product,
     pd.ProductDescription,
     p.plantnumber,

    -- Radius default MIS Data Values
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:sordernum[1]', 		'nvarchar(30)') as sordernum,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:custref[1]', 		'nvarchar(30)') as custref,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:addtcustf[1]', 		'nvarchar(30)') as addtcustref,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:sorderlinenum[1]',                   'nvarchar(30)') as sorderlinenum,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:custpolineref[1]', 	                'nvarchar(30)') as custpolineref,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:soitemtypecode[1]', 	'nvarchar(30)') as soitemtypecode,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:itemcode[1]', 		'nvarchar(30)') as itemcode,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:itemdec[1]',		'nvarchar(30)') as itemdesc,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:custitemref2[1]', 		'nvarchar(30)') as custitemref2,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:custitemref[1]', 		'nvarchar(30)') as custitemref,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:itemunitcode[1]', 		'nvarchar(30)') as itemunitcode,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:itemunitconv[1]', 		'nvarchar(30)') as itemunitconv,

    -- Radius MIS Data from Custom Properties
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:Item_Class[1]', 		'nvarchar(30)') as Item_Class,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:Item_GSM[1]', 		'nvarchar(30)') as Item_GSM,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:Est_Module[1]', 		'nvarchar(30)') as Est_Module,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:prof_blank_length[1]',	'nvarchar(30)') as prof_blank_length,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:prof_blank_width[1]', 	'nvarchar(30)') as prof_blank_width,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:prof_dim_A[1]', 	                'nvarchar(30)') as prof_dim_A,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:prof_dim_B[1]', 	                'nvarchar(30)') as prof_dim_B,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:SAL_Die_Repeat[1]', 	'nvarchar(30)') as SAL_Die_Repeat,
     pd.MISData.value('/*:AdditionalFields[1]/*:AdditionalFieldsRow[1]/*:SAL_Die_NumDown[1]', 	'nvarchar(30)') as SAL_Die_NumDown,

     s.Barcode,
     s.ContainerDescription,
     s.FinalTask,
     s.LastSkidFlag,
     s.Net,
     s.NumSkids,
     s.Routing,
     s.SkidCount,
     s.SkidType,
     s.SkidNum,
     s.StartDateTime,
     s.TxnDateTime,
     s.UOM,

     mu.MaterialUnit,
     mu.MaterialUnitCount,
     sh.Shift,
     case_qty_per.Qty,
     case_qty_per.qty_per_case,
     case_qty_per.PartialQty,
     case_qty_per.qty_per_partial_case,
     -- Next step data
     nrq.runformnumber NextFormNum,
     nrq.runformdescription NextFormDesc,
     nac.description NextWorkcenter,


    -- Subquery to extract quality questions label and data, information will be stored in field labeled Note1
    --Product index value can be found in QualityQuestion table as QualityQuestionID
    --Event code = 25 for QualityQuestions & WIP Quality Tests
    --Add additional subqueries for Multiple Quality Questions

     (select Top 1 e.Description + ' ' + e.Response from TxnSummary t, TxnEvent e where s.runId = t.RunId
    and s.AutoCountId = t.AutoCountId
    and t.TxnSummaryId = e.TxnSummaryId
    and e.TxnDateTime <= s.TxnDateTime
    and e.EventCode = '25' and e.ProductIndex = 1000002 order by t.TxnSummaryId desc) Note1


     FROM TxnSkid 		s
     LEFT  JOIN AutoCount 	a 	ON (s.AutoCountId = a.AutoCountId)
     LEFT  JOIN Plant 		p 	ON (a.PlantId = p.plantId)
     LEFT  JOIN Employee 	e 	ON (s.EmployeeId = e.EmployeeId)
     LEFT  JOIN Job 		j 	ON (s.JobId = j.JobId)
     LEFT  JOIN Form 		f 	ON ((s.FormId = f.FormId) AND (s.JobId = f.JobId))
     LEFT  JOIN Customer 	c 	ON (j.CustomerId = c.CustomerId)
     LEFT  JOIN Product 	pd 	ON (s.ProductId = pd.ProductId)
     LEFT  JOIN Shift 		sh 	ON (e.ShiftId = sh.ShiftId)
     LEFT  JOIN TxnDetail 	d 	ON (d.TxnDetailId = s.TxnDetailId)
     LEFT  JOIN TxnSummary 	t 	ON (t.TxnSummaryId = d.TxnSummaryId)

     -- next four joins are for getting next step data product to material join allows material used on next step to link to next machines
     LEFT OUTER JOIN Material	     mat     ON (pd.Product = mat.Material)
     LEFT OUTER JOIN RecipeItem   ri	ON (mat.MaterialId = ri.MaterialId)
     LEFT OUTER JOIN Recipe	    r	ON (ri.RecipeId = r.RecipeId)
     LEFT OUTER JOIN RunQueue   nrq        ON (r.FormId = nrq.FormId)
     LEFT OUTER JOIN AutoCount  nac        ON (nac.AutoCountId = nrq.AutoCountId)



    -- Sub query to get number of full rolls/cases and partial rolls/cases to be used on inventory ref tags
    LEFT JOIN
    ( SELECT Container, MAX(Qty) AS Qty, MAX(skidcount) AS qty_per_case, MIN(Qty) AS PartialQty, MIN(skidcount) AS qty_per_partial_case
      FROM ( SELECT COUNT(*) AS Qty, t1.container, t1.skidcount
                    FROM txnskid t1
                   GROUP BY t1.container, t1.skidcount ) d
    GROUP BY Container ) case_qty_per
       ON case_qty_per.container = s.Barcode

    -- Current skid recipe material unit; one aggregate row per skid.
    OUTER APPLY (
        SELECT
            CASE
                WHEN COUNT(*) = 1 THEN MAX(units.MaterialUnit)
                ELSE NULL
            END AS MaterialUnit,
            COUNT(*) AS MaterialUnitCount
        FROM (
            SELECT DISTINCT LTRIM(RTRIM(recipeMaterial.MaterialUnit)) AS MaterialUnit
            FROM dbo.RecipeItem AS recipeItem
            INNER JOIN dbo.Material AS recipeMaterial
                ON recipeMaterial.MaterialId = recipeItem.MaterialId
            WHERE recipeItem.RecipeId = s.RecipeId
              AND NULLIF(LTRIM(RTRIM(recipeMaterial.MaterialUnit)), '') IS NOT NULL
        ) AS units
    ) AS mu

     WHERE
     a.PlantId = @PlantId and
     s.Barcode = @Barcode;
END;
GO
