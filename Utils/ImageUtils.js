
const multer = require('multer');
const path = require('path');
const fs = require('fs');

function ensureFolderExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const isVideo = file.mimetype.startsWith('video');
    const isPdf = file.mimetype.startsWith('application/pdf');
    const folder = isVideo ? '/public/uploads/videos' : isPdf ? '/public/uploads/pdfs' : '/public/uploads/images';

    const uploadPath = path.join(__dirname, '..', folder);
    ensureFolderExists(uploadPath);
    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const randomId = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ext || '.bin';
    const filename = `${timestamp}-${randomId}${safeExt}`;
    cb(null, filename);
  }
});


function fileFilter(req, file, cb) {
  const allowed = /jpeg|jpg|png|gif|mp4|mov|avi|mkv|svg|webp|pdf/;
  const ext = path.extname(file.originalname).toLowerCase().substring(1);
  if (allowed.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only images and videos are allowed!'), false);
  }
}

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

module.exports = upload;
