const { z } = require('zod');
const {
  JOB_TYPES,
  COMPANY_STATUSES,
  JOB_STATUSES,
  COMPANY_INDUSTRIES,
  COMPANY_SIZES
} = require('../constants');

const companyRegistrationSchema = z.object({
  companyName: z.string()
    .min(2)
    .max(100)
    .trim(),

  username: z.string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/)
    .transform(v => v.toLowerCase()),

  email: z.string().email(),

  password: z.string().min(8)
});

const studentRegistrationSchema = z.object({
  fullName: z.string()
    .min(2)
    .max(100)
    .trim(),

  username: z.string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/)
    .transform(v => v.toLowerCase()),

  email: z.string().email(),

  password: z.string().min(8),

  profileLink: z.string()
    .url()
    .max(500)
    .optional()
    .or(z.literal(''))
});

const createJobSchema = z.object({
  title: z.string()
    .min(5, 'Title must be 5-100 characters')
    .max(100, 'Title must be 5-100 characters')
    .trim(),
  description: z.string()
    .min(50, 'Description must be 50-5000 characters')
    .max(5000, 'Description must be 50-5000 characters')
    .trim(),
  requirements: z.string()
    .min(1, 'Requirements are required')
    .max(2000, 'Requirements must be less than 2000 characters')
    .trim(),
  location: z.string()
    .min(2, 'Location must be 2-100 characters')
    .max(100, 'Location must be 2-100 characters')
    .trim(),
  jobType: z.enum(JOB_TYPES, {
    errorMap: () => ({ message: `Job type must be one of: ${JOB_TYPES.join(', ')}` })
  }),
  salaryRange: z.string()
    .min(1, 'Salary range is required')
    .max(50, 'Salary range must be less than 50 characters')
    .trim(),
  deadline: z.string()
    .datetime('Application deadline is required')
    .refine(val => new Date(val) > new Date(), 'Deadline must be in the future')
});

const updateJobSchema = createJobSchema.partial();

// Draft jobs allow incomplete data — no validation required
// Preprocess empty strings to undefined so optional() works correctly
const emptyToUndefined = (val) => (val === '' || val === null || val === undefined) ? undefined : val;

const createDraftJobSchema = z.object({
  title: z.preprocess(emptyToUndefined, z.string()
    .max(100, 'Title must be at most 100 characters')
    .trim()
    .optional()),
  description: z.preprocess(emptyToUndefined, z.string()
    .max(5000, 'Description must be at most 5000 characters')
    .trim()
    .optional()),
  requirements: z.preprocess(emptyToUndefined, z.string()
    .max(2000, 'Requirements must be less than 2000 characters')
    .trim()
    .optional()),
  location: z.preprocess(emptyToUndefined, z.string()
    .max(100, 'Location must be at most 100 characters')
    .trim()
    .optional()),
  jobType: z.preprocess(emptyToUndefined, z.enum(JOB_TYPES, {
    errorMap: () => ({ message: `Job type must be one of: ${JOB_TYPES.join(', ')}` })
  }).optional()),
  salaryRange: z.preprocess(emptyToUndefined, z.string()
    .max(50, 'Salary range must be less than 50 characters')
    .trim()
    .optional()),
  deadline: z.preprocess(emptyToUndefined, z.string()
    .datetime()
    .optional())
}).passthrough();

const updateCompanyStatusSchema = z.object({
  status: z.enum(COMPANY_STATUSES, {
    errorMap: () => ({ message: 'Status must be approved, rejected, or pending' })
  }),
  rejectionReason: z.string().trim().optional()
}).refine(data => {
  if (data.status === 'rejected') {
    return data.rejectionReason && data.rejectionReason.length > 0;
  }
  return true;
}, {
  message: 'Rejection reason is required when rejecting a company',
  path: ['rejectionReason']
});

const updateJobStatusSchema = z.object({
  status: z.enum(JOB_STATUSES, {
    errorMap: () => ({ message: `Status must be one of: ${JOB_STATUSES.join(', ')}` })
  }),
  rejectionReason: z.string().trim().optional()
});

const adminUpdateApplicationSchema = z.object({
  status: z.enum(['reviewed', 'rejected'], {
    errorMap: () => ({ message: 'Admin can only set status to reviewed or rejected' })
  }),
  rejectionReason: z.string().trim().optional()
});

const currentYear = new Date().getFullYear();

const nullableUrlSchema = z.union([
  z.string().url().max(500).trim(),
  z.literal(''),
  z.null()
]).optional();

const nullableEnum = (values) => z.union([
  z.enum(values),
  z.literal(''),
  z.null()
]).optional();

const nullableFoundedYear = z.union([
  z.number().int(),
  z.string().regex(/^\d{4}$/),
  z.null()
]).optional().refine(val => {
  if (val === undefined || val === null) return true;
  const numeric = typeof val === 'string' ? Number(val) : val;
  if (Number.isNaN(numeric)) return false;
  return numeric >= 1800 && numeric <= currentYear;
}, { message: `Founded year must be between 1800 and ${currentYear}` });

const companyProfileSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  description: z.string().max(2000).optional().nullable(),
  website: nullableUrlSchema,
  industry: nullableEnum(COMPANY_INDUSTRIES),
  size: nullableEnum(COMPANY_SIZES),
  foundedYear: nullableFoundedYear,
  linkedin: nullableUrlSchema,
  twitter: nullableUrlSchema,
  socialLinks: z.object({
    linkedin: nullableUrlSchema,
    twitter: nullableUrlSchema
  }).optional()
});

module.exports = {
  companyRegistrationSchema,
  studentRegistrationSchema,
  createJobSchema,
  createDraftJobSchema,
  updateJobSchema,
  updateCompanyStatusSchema,
  updateJobStatusSchema,
  adminUpdateApplicationSchema,
  companyProfileSchema
};
