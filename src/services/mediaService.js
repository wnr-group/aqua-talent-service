const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const AWS_REGION = process.env.AWS_REGION;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_S3_CUSTOM_DOMAIN = process.env.AWS_S3_CUSTOM_DOMAIN;

let s3Client;

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

const getS3Client = () => {
  if (!AWS_REGION) {
    throw new Error('AWS_REGION is not configured');
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
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

const buildPublicUrl = (key) => {
  if (AWS_S3_CUSTOM_DOMAIN) {
    return `https://${AWS_S3_CUSTOM_DOMAIN}/${key}`;
  }

  if (!AWS_REGION || AWS_REGION === 'us-east-1') {
    return `https://${AWS_S3_BUCKET}.s3.amazonaws.com/${key}`;
  }

  return `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
};

const assertBucketConfigured = () => {
  if (!AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }
};

const sanitizeFilename = (filename = 'video.mp4') => {
  const normalized = filename.trim() || 'video.mp4';
  return normalized.replace(/[^a-zA-Z0-9.\-_]/g, '-');
};

const uploadCompanyLogo = async (file) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  assertBucketConfigured();

  const client = getS3Client();
  const key = `company-logos/${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}.${extensionFromMime(file.mimetype)}`;

  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream'
  });

  await client.send(command);
  return buildPublicUrl(key);
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
    Bucket: AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: 'application/pdf'
  });

  await client.send(command);
  return buildPublicUrl(key);
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
    Bucket: AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype
  });

  await client.send(command);
  return buildPublicUrl(key);
};

module.exports = {
  uploadCompanyLogo,
  uploadStudentResume,
  uploadStudentVideo
};
