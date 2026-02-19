const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKETEER_AWS_REGION = process.env.BUCKETEER_AWS_REGION;
const BUCKETEER_BUCKET_NAME = process.env.BUCKETEER_BUCKET_NAME;

let s3Client;

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

const getS3Client = () => {
  if (!BUCKETEER_AWS_REGION) {
    throw new Error('BUCKETEER_AWS_REGION is not configured');
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: BUCKETEER_AWS_REGION,
      credentials: process.env.BUCKETEER_AWS_ACCESS_KEY_ID && process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY
          }
        : undefined
    });
  }

  return s3Client;
};

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

const assertBucketConfigured = () => {
  if (!BUCKETEER_BUCKET_NAME) {
    throw new Error('BUCKETEER_BUCKET_NAME is not configured');
  }
};

const sanitizeFilename = (filename = 'video.mp4') => {
  const normalized = filename.trim() || 'video.mp4';
  return normalized.replace(/[^a-zA-Z0-9.\-_]/g, '-');
};

const getPresignedUrl = async (key) => {
  if (!key) {
    return null;
  }

  assertBucketConfigured();
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: BUCKETEER_BUCKET_NAME,
    Key: key
  });

  return getSignedUrl(client, command, { expiresIn: PRESIGNED_URL_EXPIRY });
};

const uploadCompanyLogo = async (file) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  assertBucketConfigured();

  const client = getS3Client();
  const key = `company-logos/${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}.${extensionFromMime(file.mimetype)}`;

  const command = new PutObjectCommand({
    Bucket: BUCKETEER_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream'
  });

  await client.send(command);
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

  assertBucketConfigured();

  if (file.mimetype !== 'application/pdf') {
    throw new Error('Resume must be a PDF');
  }

  if (file.size > MAX_RESUME_BYTES) {
    throw new Error('Resume exceeds maximum size');
  }

  if (!isPdfBuffer(file.buffer)) {
    throw new Error('Uploaded file is not a valid PDF');
  }

  const client = getS3Client();
  const key = `student-resumes/${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}.pdf`;

  const command = new PutObjectCommand({
    Bucket: BUCKETEER_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: 'application/pdf'
  });

  await client.send(command);
  return key;
};

const uploadStudentVideo = async (file, studentId) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  if (!studentId) {
    throw new Error('Student ID is required for video upload');
  }

  assertBucketConfigured();

  if (!file.mimetype || !file.mimetype.startsWith('video/')) {
    throw new Error('Video must be a valid video file');
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error('Video must be under 30MB');
  }

  const client = getS3Client();
  const safeName = sanitizeFilename(file.originalname || 'intro-video.mp4');
  const key = `student-videos/${studentId}/${Date.now()}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKETEER_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype
  });

  await client.send(command);
  return key;
};

module.exports = {
  uploadCompanyLogo,
  uploadStudentResume,
  uploadStudentVideo,
  getPresignedUrl
};
