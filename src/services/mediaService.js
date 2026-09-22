const crypto = require('crypto');
const { getSupabaseClient } = require('../lib/supabase/client');

// One bucket per content type, created by
// supabase/migrations/20260922000001_media_storage_bucket.sql. Keys keep
// their existing prefix (company-logos/, student-resumes/, student-videos/)
// so the bucket for an already-stored key can still be resolved without a
// DB schema change.
const BUCKETS = {
  logo: 'company-logos',
  resume: 'student-resumes',
  video: 'student-videos'
};

const bucketForKey = (key) => {
  const prefix = key.split('/')[0];
  const bucket = Object.values(BUCKETS).find((id) => id === prefix);

  if (!bucket) {
    throw new Error(`Unrecognized media key prefix: ${prefix}`);
  }

  return bucket;
};

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

const extensionFromMime = (mime) => {
  if (!mime) {
    return 'png';
  }

  const mapping = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  return mapping[mime] || 'png';
};

const sanitizeFilename = (filename = 'video.mp4') => {
  const normalized = filename.trim() || 'video.mp4';
  return normalized.replace(/[^a-zA-Z0-9.\-_]/g, '-');
};

const getPresignedUrl = async (key) => {
  if (!key) {
    return null;
  }

  const supabase = getSupabaseClient();
  const bucket = bucketForKey(key);

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, PRESIGNED_URL_EXPIRY);

  if (error) {
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }

  return data.signedUrl;
};

const uploadCompanyLogo = async (file) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  const supabase = getSupabaseClient();
  const key = `company-logos/${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}.${extensionFromMime(file.mimetype)}`;

  const { error } = await supabase.storage.from(BUCKETS.logo).upload(key, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream'
  });

  if (error) {
    throw new Error(`Failed to upload company logo: ${error.message}`);
  }

  return key;
};

const isPdfBuffer = (buffer) => {
  if (!buffer || buffer.length < 4) {
    return false;
  }
  return buffer.slice(0, 4).toString('utf8') === '%PDF';
};

const uploadStudentResume = async (file) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  if (!file.mimetype || !file.mimetype.toLowerCase().includes('pdf')) {
    throw new Error('Resume must be a PDF');
  }

  if (file.size > MAX_RESUME_BYTES) {
    throw new Error('Resume exceeds maximum size');
  }

  if (!isPdfBuffer(file.buffer)) {
    throw new Error('Uploaded file is not a valid PDF');
  }

  const supabase = getSupabaseClient();
  const key = `student-resumes/${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}.pdf`;

  const { error } = await supabase.storage.from(BUCKETS.resume).upload(key, file.buffer, {
    contentType: 'application/pdf'
  });

  if (error) {
    throw new Error(`Failed to upload resume: ${error.message}`);
  }

  return key;
};

const uploadStudentVideo = async (file, studentId) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  if (!studentId) {
    throw new Error('Student ID is required for video upload');
  }

  if (!file.mimetype || !file.mimetype.startsWith('video/')) {
    throw new Error('Video must be a valid video file');
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error('Video must be under 30MB');
  }

  const supabase = getSupabaseClient();
  const safeName = sanitizeFilename(file.originalname || 'intro-video.mp4');
  const key = `student-videos/${studentId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKETS.video).upload(key, file.buffer, {
    contentType: file.mimetype
  });

  if (error) {
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  return key;
};

module.exports = {
  uploadCompanyLogo,
  uploadStudentResume,
  uploadStudentVideo,
  getPresignedUrl
};
