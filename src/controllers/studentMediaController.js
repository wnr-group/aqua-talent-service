"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../lib/supabase/client");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uploadStudentVideo } = require('../services/mediaService');
const supabase = (0, client_1.getSupabaseClient)();
exports.uploadIntroVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Video file is required' });
        }
        const { data: student } = await supabase.from('students').select('id').eq('user_id', req.user.userId).maybeSingle();
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        const introVideoUrl = await uploadStudentVideo(req.file, student.id);
        await supabase.from('students').update({ intro_video_url: introVideoUrl }).eq('id', student.id);
        res.json({ introVideoUrl });
    }
    catch (error) {
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
        const { data: student } = await supabase.from('students').select('id, intro_video_url').eq('user_id', req.user.userId).maybeSingle();
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        if (!student.intro_video_url) {
            return res.status(400).json({ error: 'No intro video to delete' });
        }
        await supabase.from('students').update({ intro_video_url: null }).eq('id', student.id);
        res.json({ success: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
//# sourceMappingURL=studentMediaController.js.map