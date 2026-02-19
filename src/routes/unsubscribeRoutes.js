const express = require('express');
const { logEmailSuccess } = require('../utils/emailLogger');

const router = express.Router();

router.get('/unsubscribe', (req, res) => {
  const { email } = req.query;

  if (email) {
    logEmailSuccess('Unsubscribe request recorded', { email });
  } else {
    logEmailSuccess('Unsubscribe endpoint hit without email');
  }

  res.send('You have been unsubscribed. If this was a mistake, you can re-enable notifications from your AquaTalentz settings.');
});

module.exports = router;
