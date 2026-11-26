using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OneReports.Migrations
{
    /// <inheritdoc />
    public partial class DepartmentReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DepartmentReports",
                columns: table => new
                {
                    DepartmentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReportId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AssignedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AssignedBy = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DepartmentReports", x => new { x.DepartmentId, x.ReportId });
                    table.ForeignKey(
                        name: "FK_DepartmentReports_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // An administrator may already have created an "Estimation" department on the People page:
            // keep theirs rather than failing on the unique name.
            migrationBuilder.Sql("""
                IF NOT EXISTS (SELECT 1 FROM [Departments] WHERE [Name] = N'Estimation')
                    INSERT INTO [Departments] ([Id], [CreatedAt], [Description], [Name])
                    VALUES ('d3a1e0f0-0000-4000-8000-000000000018', '2026-11-18T00:00:00.0000000+00:00',
                        N'Job costing, quotations and material estimates.', N'Estimation');
                """);

            migrationBuilder.CreateIndex(
                name: "IX_DepartmentReports_ReportId",
                table: "DepartmentReports",
                column: "ReportId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DepartmentReports");

            migrationBuilder.DeleteData(
                table: "Departments",
                keyColumn: "Id",
                keyValue: new Guid("d3a1e0f0-0000-4000-8000-000000000018"));
        }
    }
}
