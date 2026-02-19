const Student = require('../models/Student');
const { uploadStudentVideo } = require('../services/mediaService');

exports.uploadIntroVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const introVideoUrl = await uploadStudentVideo(req.file, student._id.toString());

    student.introVideoUrl = introVideoUrl;
    await student.save();

    res.json({ introVideoUrl });
  } catch (error) {
    const clientErrorIndicators = ['video', 'file buffer', 'student id'];

    if (error.message && clientErrorIndicators.some((indicator) => error.message.toLowerCase().includes(indicator))) {
      return res.status(400).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteIntroVideo = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.introVideoUrl) {
      return res.status(400).json({ error: 'No intro video to delete' });
    }

    student.introVideoUrl = null;
    await student.save();

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
