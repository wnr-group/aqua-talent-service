const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const AWS_REGION = process.env.AWS_REGION;
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const AWS_S3_CUSTOM_DOMAIN = process.env.AWS_S3_CUSTOM_DOMAIN;

let s3Client;

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

const uploadCompanyLogo = async (file) => {
  if (!file?.buffer) {
    throw new Error('Missing file buffer');
  }

  if (!AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

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

module.exports = {
  uploadCompanyLogo
};
