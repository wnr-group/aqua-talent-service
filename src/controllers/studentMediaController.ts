import { Request, Response } from 'express';

import { getSupabaseClient } from '../lib/supabase/client';
const { uploadStudentVideo } = require('../services/mediaService');

type AuthedRequest = Request & { user?: { userId: string; userType: string }; file?: any };

const supabase = getSupabaseClient();

exports.uploadIntroVideo = async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    const { data: student } = await supabase.from('students').select('id').eq('user_id', req.user!.userId).maybeSingle();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const introVideoUrl = await uploadStudentVideo(req.file, student.id);

    const { error: updateError } = await supabase.from('students').update({ intro_video_url: introVideoUrl }).eq('id', student.id);
    if (updateError) throw updateError;

    res.json({ introVideoUrl });
  } catch (error: any) {
    const clientErrorIndicators = ['video', 'file buffer', 'student id'];

    if (error.message && clientErrorIndicators.some((indicator: string) => error.message.toLowerCase().includes(indicator))) {
      return res.status(400).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteIntroVideo = async (req: AuthedRequest, res: Response) => {
  try {
    const { data: student } = await supabase.from('students').select('id, intro_video_url').eq('user_id', req.user!.userId).maybeSingle();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.intro_video_url) {
      return res.status(400).json({ error: 'No intro video to delete' });
    }

    const { error: clearError } = await supabase.from('students').update({ intro_video_url: null }).eq('id', student.id);
    if (clearError) throw clearError;

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
