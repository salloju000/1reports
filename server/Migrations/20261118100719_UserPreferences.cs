using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OneReports.Migrations
{
    /// <inheritdoc />
    public partial class UserPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Density",
                table: "UserProfiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreferredView",
                table: "UserProfiles",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Density",
                table: "UserProfiles");

            migrationBuilder.DropColumn(
                name: "PreferredView",
                table: "UserProfiles");
        }
    }
}
