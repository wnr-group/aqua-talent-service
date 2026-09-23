const PUBLIC_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const publicProfileCache = new Map<string, { data: any; expiresAt: number }>();

const normalizeNullable = (value: any) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return value;
};

const normalizeYear = (value: any) => {
  const normalized = normalizeNullable(value);
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === null) {
    return null;
  }
  const numeric = typeof normalized === 'number' ? normalized : Number(normalized);
  if (Number.isNaN(numeric)) {
    return undefined;
  }
  return numeric;
};

/**
 * Builds a Postgres update payload (snake_case) from the profile edit
 * request, given the company's current row. Unlike the old Mongoose version
 * this does not mutate anything - it returns { updates, company } where
 * `company` is the row with the pending changes merged in (for downstream
 * response building) and `updates` is what the caller should persist via
 * `.update()`.
 */
export const applyCompanyProfileUpdates = (
  company: any,
  payload: any,
  options: { allowNameEdit?: boolean } = {}
): { updates: Record<string, any>; company: any } => {
  const { allowNameEdit = false } = options;

  if (!company) {
    throw new Error('Company record not provided');
  }

  const updates: Record<string, any> = {};
  const next = { ...company };

  if (payload.name !== undefined) {
    if (company.status === 'approved' && !allowNameEdit && payload.name !== company.name) {
      throw new Error('APPROVED_COMPANY_NAME_READONLY');
    }
    if (allowNameEdit || company.status !== 'approved') {
      updates.name = payload.name;
      next.name = payload.name;
    }
  }

  if (payload.description !== undefined) {
    const description = payload.description?.trim() ? payload.description.trim() : null;
    updates.description = description;
    next.description = description;
  }

  const website = normalizeNullable(payload.website);
  if (website !== undefined) {
    updates.website = website;
    next.website = website;
  }

  const industry = normalizeNullable(payload.industry);
  if (industry !== undefined) {
    updates.industry = industry;
    next.industry = industry;
  }

  const size = normalizeNullable(payload.size);
  if (size !== undefined) {
    updates.size = size;
    next.size = size;
  }

  const foundedYear = normalizeYear(payload.foundedYear);
  if (foundedYear !== undefined) {
    updates.founded_year = foundedYear;
    next.founded_year = foundedYear;
  }

  // Support both top-level and nested socialLinks structure
  const linkedin = normalizeNullable(payload.linkedin ?? payload.socialLinks?.linkedin);
  if (linkedin !== undefined) {
    updates.social_linkedin = linkedin;
    next.social_linkedin = linkedin;
  }

  const twitter = normalizeNullable(payload.twitter ?? payload.socialLinks?.twitter);
  if (twitter !== undefined) {
    updates.social_twitter = twitter;
    next.social_twitter = twitter;
  }

  return { updates, company: next };
};

export const buildCompanyProfileResponse = (company: any) => {
  if (!company) {
    return null;
  }

  return {
    id: company.id,
    name: company.name,
    email: company.email,
    status: company.status,
    logo: company.logo,
    website: company.website,
    description: company.description,
    industry: company.industry,
    size: company.size,
    socialLinks: {
      linkedin: company.social_linkedin || null,
      twitter: company.social_twitter || null
    },
    foundedYear: company.founded_year,
    createdAt: company.created_at,
    approvedAt: company.approved_at
  };
};

export const buildPublicCompanyProfile = (company: any) => {
  const base = buildCompanyProfileResponse(company);
  if (!base) {
    return null;
  }

  return {
    id: base.id,
    name: base.name,
    logo: base.logo,
    description: base.description,
    industry: base.industry,
    size: base.size,
    website: base.website,
    socialLinks: base.socialLinks,
    foundedYear: base.foundedYear
  };
};

const getCacheKey = (companyId: string) => String(companyId);

export const getCachedPublicCompanyProfile = (companyId: string) => {
  const cacheEntry = publicProfileCache.get(getCacheKey(companyId));
  if (!cacheEntry) {
    return null;
  }
  if (cacheEntry.expiresAt < Date.now()) {
    publicProfileCache.delete(getCacheKey(companyId));
    return null;
  }
  return cacheEntry.data;
};

export const setCachedPublicCompanyProfile = (companyId: string, profile: any) => {
  publicProfileCache.set(getCacheKey(companyId), {
    data: profile,
    expiresAt: Date.now() + PUBLIC_PROFILE_CACHE_TTL_MS
  });
};

export const invalidatePublicCompanyProfileCache = (companyId: string) => {
  publicProfileCache.delete(getCacheKey(companyId));
};
