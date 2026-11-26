using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The organisation's name and logo for the workspace header. Everyone signed in can see them (they come
/// with /api/auth/me, and the logo from /api/organization/logo); only administrators can change them.
/// Logos are PNG, JPEG or WebP up to 512 KB, recognised by their content rather than their file name.
/// SVG is refused: it can carry script.
/// </summary>
internal static class OrganizationEndpoints
{
    private static readonly (string Type, byte[][] Signatures)[] ImageTypes =
    [
        ("image/png", [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]),
        ("image/jpeg", [[0xFF, 0xD8, 0xFF]]),
    ];

    internal static void MapOrganization(this WebApplication app)
    {
        // Signed-in people only (the fallback policy); the URL carries a version, so browsers may keep it.
        app.MapGet("/api/organization/logo", LogoAsync);

        var admin = app.MapGroup("/api/admin/organization")
            .RequireAuthorization(policy => policy.RequireRole("Administrator").RequireClaim(ClaimTypes.NameIdentifier));
        admin.MapPut("/", SaveNameAsync);
        admin.MapPut("/logo", SaveLogoAsync)
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(HubOrganization.MaxLogoBytes + 64 * 1024));
        admin.MapDelete("/logo", RemoveLogoAsync);
    }

    private sealed record NameRequest(string? Name);

    /// <summary>What the header needs: the name, and the logo's address (versioned) when there is one.</summary>
    /// <remarks>
    /// Never fails sign-in: if the table isn't there yet (the release deployed before its SQL ran), the
    /// header simply shows no branding.
    /// </remarks>
    internal static async Task<object> ReadAsync(HubIdentityDb db, CancellationToken cancellation)
    {
        try
        {
            var row = await db.Organization.AsNoTracking()
                .Where(item => item.Id == HubOrganization.SingletonId)
                .Select(item => new { item.Name, HasLogo = item.Logo != null, item.UpdatedAt })
                .FirstOrDefaultAsync(cancellation);
            return View(row?.Name, row?.HasLogo == true, row?.UpdatedAt);
        }
        catch (System.Data.Common.DbException)
        {
            return View(null, false, null);
        }
    }

    private static object View(string? name, bool hasLogo, DateTimeOffset? updatedAt) => new
    {
        name = string.IsNullOrWhiteSpace(name) ? null : name,
        logo = hasLogo ? $"organization/logo?v={updatedAt?.ToUnixTimeMilliseconds()}" : null,
    };

    private static object View(HubOrganization row) => View(row.Name, row.Logo is not null, row.UpdatedAt);

    private static async Task<IResult> LogoAsync(HttpContext context, HubIdentityDb db, CancellationToken cancellation)
    {
        var row = await db.Organization.AsNoTracking()
            .Where(item => item.Id == HubOrganization.SingletonId && item.Logo != null)
            .Select(item => new { item.Logo, item.LogoContentType })
            .FirstOrDefaultAsync(cancellation);
        if (row?.Logo is null || row.LogoContentType is null) return Results.NotFound();
        context.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return Results.File(row.Logo, row.LogoContentType);
    }

    internal static Dictionary<string, string[]> ValidateName(string? name)
    {
        var errors = new Dictionary<string, string[]>();
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length > HubOrganization.MaxName)
            errors["name"] = [$"Use at most {HubOrganization.MaxName} characters."];
        else if (trimmed.Any(char.IsControl))
            errors["name"] = ["Use letters, numbers and punctuation only."];
        return errors;
    }

    /// <summary>The image type from the file's first bytes, or null when it isn't a PNG, JPEG or WebP.</summary>
    internal static string? ImageType(ReadOnlySpan<byte> content)
    {
        foreach (var (type, signatures) in ImageTypes)
            foreach (var signature in signatures)
                if (content.StartsWith(signature)) return type;
        // WebP: "RIFF" <size> "WEBP".
        if (content.Length >= 12 && content[..4].SequenceEqual("RIFF"u8) && content.Slice(8, 4).SequenceEqual("WEBP"u8))
            return "image/webp";
        return null;
    }

    private static async Task<HubOrganization> RowAsync(HubIdentityDb db, CancellationToken cancellation)
    {
        var row = await db.Organization.FindAsync([HubOrganization.SingletonId], cancellation);
        if (row is not null) return row;
        row = new HubOrganization();
        db.Organization.Add(row);
        return row;
    }

    private static void Touch(HubOrganization row, HttpContext context)
    {
        row.UpdatedAt = DateTimeOffset.UtcNow;
        row.UpdatedBy = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    }

    private static async Task<IResult> SaveNameAsync(NameRequest request, HttpContext context, IAntiforgery antiforgery,
        HubIdentityDb db, CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var errors = ValidateName(request.Name);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var row = await RowAsync(db, cancellation);
        var name = request.Name?.Trim();
        row.Name = string.IsNullOrEmpty(name) ? null : name;
        Touch(row, context);
        await db.SaveChangesAsync(cancellation);
        return Results.Ok(View(row));
    }

    private static async Task<IResult> SaveLogoAsync(HttpContext context, IAntiforgery antiforgery, HubIdentityDb db,
        CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context) || !context.Request.HasFormContentType) return Results.BadRequest();
        var form = await context.Request.ReadFormAsync(cancellation);
        var file = form.Files.GetFile("logo");
        if (file is null || file.Length == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["logo"] = ["Choose an image."] });
        if (file.Length > HubOrganization.MaxLogoBytes)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["logo"] = ["Use an image of 512 KB or less."] });
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, cancellation);
        var content = buffer.ToArray();
        var type = ImageType(content);
        if (type is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["logo"] = ["Use a PNG, JPEG or WebP image."] });
        var row = await RowAsync(db, cancellation);
        row.Logo = content;
        row.LogoContentType = type;
        Touch(row, context);
        await db.SaveChangesAsync(cancellation);
        return Results.Ok(View(row));
    }

    private static async Task<IResult> RemoveLogoAsync(HttpContext context, IAntiforgery antiforgery, HubIdentityDb db,
        CancellationToken cancellation)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest();
        var row = await RowAsync(db, cancellation);
        row.Logo = null;
        row.LogoContentType = null;
        Touch(row, context);
        await db.SaveChangesAsync(cancellation);
        return Results.Ok(View(row));
    }
}
