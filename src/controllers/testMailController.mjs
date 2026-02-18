import emailService from '../services/emailService.js';

const { sendWelcomeEmail } = emailService;

const isEmailEnabled = () => (process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true';

export const testMail = (req, res) => {
  const emailEnabled = isEmailEnabled();

  if (!emailEnabled) {
    console.warn('[test-mail] Email disabled');
  }

  Promise.resolve()
    .then(() => {
      if (emailEnabled) {
        return sendWelcomeEmail('eshwarpaygude@gmail.com', { name: 'Eshwar' });
      }
      return null;
    })
    .catch((error) => {
      console.error('[test-mail] Failed to send email', error);
    });

  res.json({ message: 'Triggered email' });
};
