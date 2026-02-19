const PUBLIC_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const publicProfileCache = new Map();

const normalizeNullable = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return value;
};

const normalizeYear = (value) => {
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

const applyCompanyProfileUpdates = (company, payload, options = {}) => {
  const { allowNameEdit = false } = options;

  if (!company) {
    throw new Error('Company record not provided');
  }

  if (payload.name !== undefined) {
    if (company.status === 'approved' && !allowNameEdit && payload.name !== company.name) {
      const error = new Error('APPROVED_COMPANY_NAME_READONLY');
      throw error;
    }
    if (allowNameEdit || company.status !== 'approved') {
      company.name = payload.name;
    }
  }

  if (payload.description !== undefined) {
    company.description = payload.description?.trim() ? payload.description.trim() : null;
  }

  const website = normalizeNullable(payload.website);
  if (website !== undefined) {
    company.website = website;
  }

  const industry = normalizeNullable(payload.industry);
  if (industry !== undefined) {
    company.industry = industry;
  }

  const size = normalizeNullable(payload.size);
  if (size !== undefined) {
    company.size = size;
  }

  const foundedYear = normalizeYear(payload.foundedYear);
  if (foundedYear !== undefined) {
    company.foundedYear = foundedYear;
  }

  if (!company.socialLinks) {
    company.socialLinks = {};
  }

  // Support both top-level and nested socialLinks structure
  const linkedin = normalizeNullable(payload.linkedin ?? payload.socialLinks?.linkedin);
  let socialLinksModified = false;
  if (linkedin !== undefined) {
    company.socialLinks.linkedin = linkedin;
    socialLinksModified = true;
  }

  const twitter = normalizeNullable(payload.twitter ?? payload.socialLinks?.twitter);
  if (twitter !== undefined) {
    company.socialLinks.twitter = twitter;
    socialLinksModified = true;
  }

  if (socialLinksModified && typeof company.markModified === 'function') {
    company.markModified('socialLinks');
  }

  return company;
};

const buildCompanyProfileResponse = (company) => {
  if (!company) {
    return null;
  }

  const doc = typeof company.toObject === 'function' ? company.toObject() : company;

  return {
    id: doc._id?.toString() || null,
    name: doc.name,
    email: doc.email,
    status: doc.status,
    logo: doc.logo,
    website: doc.website,
    description: doc.description,
    industry: doc.industry,
    size: doc.size,
    socialLinks: {
      linkedin: doc.socialLinks?.linkedin || null,
      twitter: doc.socialLinks?.twitter || null
    },
    foundedYear: doc.foundedYear,
    createdAt: doc.createdAt,
    approvedAt: doc.approvedAt
  };
};

const buildPublicCompanyProfile = (company) => {
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

const getCacheKey = (companyId) => companyId.toString();

const getCachedPublicCompanyProfile = (companyId) => {
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

const setCachedPublicCompanyProfile = (companyId, profile) => {
  publicProfileCache.set(getCacheKey(companyId), {
    data: profile,
    expiresAt: Date.now() + PUBLIC_PROFILE_CACHE_TTL_MS
  });
};

const invalidatePublicCompanyProfileCache = (companyId) => {
  publicProfileCache.delete(getCacheKey(companyId));
};

module.exports = {
  applyCompanyProfileUpdates,
  buildCompanyProfileResponse,
  buildPublicCompanyProfile,
  getCachedPublicCompanyProfile,
  setCachedPublicCompanyProfile,
  invalidatePublicCompanyProfileCache
};
