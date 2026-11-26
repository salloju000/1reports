import { apiRequest, apiUrl, ApiError, csrfToken, FormError, sendJson } from "./api";

/** The organisation's name and logo for the workspace header; `logo` is a versioned API route. */
export type Organization = { name: string | null; logo: string | null };

export const noOrganization: Organization = { name: null, logo: null };

/** The largest logo the server accepts, and the image types it recognises. */
export const maxLogoBytes = 512 * 1024;
export const logoTypes = ["image/png", "image/jpeg", "image/webp"];

/** Where the browser loads the logo from. */
export const logoUrl = (organization: Organization) => organization.logo ? apiUrl(organization.logo) : null;

/** Reads the organization from an /api/auth/me response, ignoring anything malformed. */
export function readOrganization(value: unknown): Organization {
  const item = value as Partial<Organization> | null | undefined;
  return {
    name: typeof item?.name === "string" && item.name.trim() ? item.name : null,
    logo: typeof item?.logo === "string" && /^organization\/logo\?v=\d+$/.test(item.logo) ? item.logo : null,
  };
}

/** Administrator-only changes; each returns the organization as saved. */
export const organization = {
  saveName: async (name: string) => readOrganization(await sendJson<unknown>("admin/organization", "PUT", { name })),
  removeLogo: async () => readOrganization(await sendJson<unknown>("admin/organization/logo", "DELETE")),
  async saveLogo(file: File): Promise<Organization> {
    const signal = AbortSignal.timeout(30000);
    const token = await csrfToken(signal);
    const body = new FormData();
    body.append("logo", file, file.name);
    const response = await apiRequest("admin/organization/logo", { method: "PUT", signal, body, headers: { "X-CSRF-TOKEN": token } });
    if (response.ok) return readOrganization(await response.json());
    const problem = await response.json().catch(() => null);
    if (response.status === 400 && problem?.errors?.logo) throw new FormError({ logo: [problem.errors.logo].flat().join(" ") });
    if (response.status === 413) throw new FormError({ logo: "Use an image of 512 KB or less." });
    throw new ApiError(response.status);
  },
};
