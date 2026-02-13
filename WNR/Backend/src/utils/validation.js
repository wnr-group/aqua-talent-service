const { z } = require('zod');

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

module.exports = {
  companyRegistrationSchema,
  studentRegistrationSchema
};
