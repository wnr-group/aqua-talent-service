const express = require('express');
const { getPresignedUrl } = require('../services/mediaService');

const router = express.Router();

router.get('/url', async (req, res) => {
  try {
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }

    const url = await getPresignedUrl(key);
    res.json({ url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate URL' });
  }
});

module.exports = router;
