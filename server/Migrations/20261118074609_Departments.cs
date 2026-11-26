using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace OneReports.Migrations
{
    /// <inheritdoc />
    public partial class Departments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Departments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Departments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserProfiles",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    FullName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserProfiles", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_UserProfiles_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserProfiles_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "Departments",
                columns: new[] { "Id", "CreatedAt", "Description", "Name" },
                values: new object[,]
                {
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000001"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Plant leadership and general management.", "Management" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000002"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Enquiries, orders, artwork approvals and customer communication.", "Sales & Customer Service" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000003"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Job planning, scheduling and machine loading.", "Planning & Production Control" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000004"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Artwork, colour separation, plates and gravure cylinders.", "Pre-press & Cylinders" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000005"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Blown and cast film extrusion.", "Extrusion" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000006"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Rotogravure and flexographic printing.", "Printing" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000007"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Solvent-based and solventless lamination.", "Lamination" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000008"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Slitting, rewinding and roll finishing.", "Slitting & Rewinding" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000009"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Pouch, bag and sleeve conversion.", "Pouching & Bag Making" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000010"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Incoming, in-process and final inspection; lab testing.", "Quality Assurance" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000011"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Raw materials, inks, adhesives, WIP and finished goods.", "Stores & Inventory" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000012"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Packing, labelling and shipments.", "Dispatch & Logistics" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000013"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Procurement of substrates, inks, adhesives and spares.", "Purchase" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000014"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Machine maintenance, utilities and engineering.", "Maintenance & Utilities" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000015"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "Costing, billing and accounts.", "Accounts & Finance" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000016"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "People, payroll and plant administration.", "HR & Administration" },
                    { new Guid("d3a1e0f0-0000-4000-8000-000000000017"), new DateTimeOffset(new DateTime(2026, 11, 18, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)), "ERP, reports and IT infrastructure.", "IT & Systems" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_Departments_Name",
                table: "Departments",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserProfiles_DepartmentId",
                table: "UserProfiles",
                column: "DepartmentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserProfiles");

            migrationBuilder.DropTable(
                name: "Departments");
        }
    }
}
