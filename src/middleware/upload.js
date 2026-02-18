const multer = require('multer');

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const RESUME_MIME_TYPES = ['application/pdf'];
const MAX_VIDEO_SIZE_BYTES = 31 * 1024 * 1024; // 31MB internal cap
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/x-msvideo'];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error('Only JPG, PNG, or WEBP images are allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES
  }
});

const resumeFileFilter = (req, file, cb) => {
  if (!RESUME_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error('Only PDF resumes are allowed'));
  }
  cb(null, true);
};

const resumeUpload = multer({
  storage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: MAX_RESUME_SIZE_BYTES
  }
});

const videoFileFilter = (req, file, cb) => {
  if (!VIDEO_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error('Only video files are allowed'));
  }
  cb(null, true);
};

const videoUpload = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: MAX_VIDEO_SIZE_BYTES
  }
});

module.exports = {
  upload,
  resumeUpload,
  videoUpload,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  MAX_RESUME_SIZE_BYTES,
  RESUME_MIME_TYPES,
  MAX_VIDEO_SIZE_BYTES,
  VIDEO_MIME_TYPES
};
