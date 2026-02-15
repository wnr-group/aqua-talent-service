const { z } = require('zod');
const { JOB_TYPES, COMPANY_STATUSES, JOB_STATUSES } = require('../constants');

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
    .max(2000, 'Requirements must be less than 2000 characters')
    .trim()
    .optional(),
  location: z.string()
    .min(2, 'Location must be 2-100 characters')
    .max(100, 'Location must be 2-100 characters')
    .trim(),
  jobType: z.enum(JOB_TYPES, {
    errorMap: () => ({ message: `Job type must be one of: ${JOB_TYPES.join(', ')}` })
  }),
  salaryRange: z.string()
    .max(50, 'Salary range must be less than 50 characters')
    .trim()
    .optional(),
  deadline: z.string()
    .datetime()
    .optional()
    .refine(val => !val || new Date(val) > new Date(), 'Deadline must be in the future')
});

const updateJobSchema = createJobSchema.partial();

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
    errorMap: () => ({ message: 'Status must be approved, rejected, closed, or pending' })
  }),
  rejectionReason: z.string().trim().optional()
});

const adminUpdateApplicationSchema = z.object({
  status: z.enum(['reviewed', 'rejected'], {
    errorMap: () => ({ message: 'Admin can only set status to reviewed or rejected' })
  }),
  rejectionReason: z.string().trim().optional()
});

module.exports = {
  companyRegistrationSchema,
  studentRegistrationSchema,
  createJobSchema,
  updateJobSchema,
  updateCompanyStatusSchema,
  updateJobStatusSchema,
  adminUpdateApplicationSchema
};
