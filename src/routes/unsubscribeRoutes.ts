import { Request, Response, Router } from 'express';

const { logEmailSuccess } = require('../utils/emailLogger');

const router = Router();

router.get('/unsubscribe', (req: Request, res: Response) => {
  const { email } = req.query;

  if (email) {
    logEmailSuccess('Unsubscribe request recorded', { email });
  } else {
    logEmailSuccess('Unsubscribe endpoint hit without email');
  }

  res.send('You have been unsubscribed. If this was a mistake, you can re-enable notifications from your AquaTalentz settings.');
});

export = router;
