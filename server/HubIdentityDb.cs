using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

internal sealed class HubIdentityDb(DbContextOptions<HubIdentityDb> options)
    : IdentityDbContext<IdentityUser, IdentityRole, string>(options)
{
    internal DbSet<HubFavorite> Favorites => Set<HubFavorite>();
    internal DbSet<HubReportEvent> ReportEvents => Set<HubReportEvent>();
    internal DbSet<HubReportCredential> ReportCredentials => Set<HubReportCredential>();
    internal DbSet<HubDepartment> Departments => Set<HubDepartment>();
    internal DbSet<HubUserProfile> UserProfiles => Set<HubUserProfile>();
    internal DbSet<HubDepartmentReport> DepartmentReports => Set<HubDepartmentReport>();
    internal DbSet<HubOrganization> Organization => Set<HubOrganization>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<HubFavorite>(entity =>
        {
            entity.HasKey(row => new { row.UserId, row.ReportId });
            entity.Property(row => row.ReportId).HasMaxLength(64);
            entity.HasOne<IdentityUser>().WithMany().HasForeignKey(row => row.UserId);
        });
        builder.Entity<HubReportEvent>(entity =>
        {
            entity.HasKey(row => new { row.UserId, row.ReportId, row.InteractionId, row.Kind });
            entity.Property(row => row.ReportId).HasMaxLength(64);
            entity.Property(row => row.Kind).HasMaxLength(20);
            entity.HasIndex(row => new { row.UserId, row.At });
            entity.HasIndex(row => row.At);
            entity.HasOne<IdentityUser>().WithMany().HasForeignKey(row => row.UserId);
        });
        builder.Entity<HubReportCredential>(entity =>
        {
            entity.HasKey(row => row.ConnectionId);
            entity.Property(row => row.ConnectionId).HasMaxLength(16);
            entity.Property(row => row.Source).HasMaxLength(256);
            entity.Property(row => row.Database).HasMaxLength(256);
            entity.Property(row => row.Provider).HasMaxLength(128);
            entity.Property(row => row.Login).HasMaxLength(128);
            entity.Property(row => row.UpdatedBy).HasMaxLength(450);
        });
        builder.Entity<HubDepartment>(entity =>
        {
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Name).HasMaxLength(HubDepartment.MaxName);
            entity.Property(row => row.Description).HasMaxLength(HubDepartment.MaxDescription);
            entity.HasIndex(row => row.Name).IsUnique();
            entity.HasData(HubDepartment.Defaults);
        });
        builder.Entity<HubUserProfile>(entity =>
        {
            entity.HasKey(row => row.UserId);
            entity.Property(row => row.FullName).HasMaxLength(HubUserProfile.MaxFullName);
            entity.Property(row => row.PreferredView).HasMaxLength(16);
            entity.Property(row => row.Density).HasMaxLength(16);
            entity.HasOne<IdentityUser>().WithOne().HasForeignKey<HubUserProfile>(row => row.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            // A department with people in it cannot be removed: move them first.
            entity.HasOne<HubDepartment>().WithMany().HasForeignKey(row => row.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(row => row.DepartmentId);
        });
        builder.Entity<HubOrganization>(entity =>
        {
            entity.ToTable("Organization");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).ValueGeneratedNever();
            entity.Property(row => row.Name).HasMaxLength(HubOrganization.MaxName);
            entity.Property(row => row.LogoContentType).HasMaxLength(32);
            entity.Property(row => row.UpdatedBy).HasMaxLength(450);
        });
        builder.Entity<HubDepartmentReport>(entity =>
        {
            entity.HasKey(row => new { row.DepartmentId, row.ReportId });
            entity.Property(row => row.ReportId).HasMaxLength(64);
            entity.Property(row => row.AssignedBy).HasMaxLength(450);
            entity.HasIndex(row => row.ReportId);
            // Removing a department removes its collection; the reports themselves are untouched.
            entity.HasOne<HubDepartment>().WithMany().HasForeignKey(row => row.DepartmentId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}

/// <summary>An organisational unit people belong to. Each person belongs to at most one department.</summary>
internal sealed class HubDepartment
{
    internal const int MaxName = 100;
    internal const int MaxDescription = 300;
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The departments of a typical flexible packaging converter, seeded once so a new installation
    /// starts organised. Administrators can rename, add or remove them afterwards.
    /// </summary>
    internal static readonly HubDepartment[] Defaults = Seed(
        ("Management", "Plant leadership and general management."),
        ("Sales & Customer Service", "Enquiries, orders, artwork approvals and customer communication."),
        ("Planning & Production Control", "Job planning, scheduling and machine loading."),
        ("Pre-press & Cylinders", "Artwork, colour separation, plates and gravure cylinders."),
        ("Extrusion", "Blown and cast film extrusion."),
        ("Printing", "Rotogravure and flexographic printing."),
        ("Lamination", "Solvent-based and solventless lamination."),
        ("Slitting & Rewinding", "Slitting, rewinding and roll finishing."),
        ("Pouching & Bag Making", "Pouch, bag and sleeve conversion."),
        ("Quality Assurance", "Incoming, in-process and final inspection; lab testing."),
        ("Stores & Inventory", "Raw materials, inks, adhesives, WIP and finished goods."),
        ("Dispatch & Logistics", "Packing, labelling and shipments."),
        ("Purchase", "Procurement of substrates, inks, adhesives and spares."),
        ("Maintenance & Utilities", "Machine maintenance, utilities and engineering."),
        ("Accounts & Finance", "Costing, billing and accounts."),
        ("HR & Administration", "People, payroll and plant administration."),
        ("IT & Systems", "ERP, reports and IT infrastructure."),
        ("Estimation", "Job costing, quotations and material estimates."));

    private static HubDepartment[] Seed(params (string Name, string Description)[] rows) =>
        rows.Select((row, index) => new HubDepartment
        {
            // Fixed ids keep the seed stable across migrations.
            Id = new Guid($"d3a1e0f0-0000-4000-8000-{index + 1:D12}"),
            Name = row.Name,
            Description = row.Description,
            CreatedAt = new DateTimeOffset(2026, 11, 18, 0, 0, 0, TimeSpan.Zero),
        }).ToArray();
}

/// <summary>
/// The organisation's own name and logo, shown in the workspace header. One row (Id 1), set by administrators.
/// The logo is a small raster image kept in the database, so it travels with backups and needs no file share.
/// </summary>
internal sealed class HubOrganization
{
    internal const int SingletonId = 1;
    internal const int MaxName = 100;
    internal const int MaxLogoBytes = 512 * 1024;
    public int Id { get; set; } = SingletonId;
    public string? Name { get; set; }
    public byte[]? Logo { get; set; }
    public string? LogoContentType { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

/// <summary>Directory details kept alongside an Identity account: who the person is and where they work.</summary>
internal sealed class HubUserProfile
{
    internal const int MaxFullName = 200;
    public required string UserId { get; set; }
    public required string FullName { get; set; }
    public Guid? DepartmentId { get; set; }
    /// <summary>The person's own display preferences (Settings), null until they save them.</summary>
    public string? PreferredView { get; set; }
    public string? Density { get; set; }
}

/// <summary>
/// The database login saved by an administrator for one report data source. The password is held
/// only as a Data Protection payload bound to the connection id, never in plain text.
/// </summary>
internal sealed class HubReportCredential
{
    public required string ConnectionId { get; set; }
    public required string Source { get; set; }
    public required string Database { get; set; }
    public required string Provider { get; set; }
    public required string Login { get; set; }
    public required string ProtectedPassword { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public required string UpdatedBy { get; set; }
}

/// <summary>
/// A report in a department's collection. Everyone in the department may open and run it, in addition
/// to the reports their roles already allow. The report stays in the global library either way.
/// </summary>
internal sealed record HubDepartmentReport(Guid DepartmentId, string ReportId, DateTimeOffset AssignedAt, string AssignedBy);
internal sealed record HubFavorite(string UserId, string ReportId);
internal sealed record HubReportEvent(string UserId, string ReportId, Guid InteractionId, string Kind, DateTimeOffset At);
