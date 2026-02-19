import { Router } from 'express';
import { testMail } from '../controllers/testMailController.mjs';

const router = Router();

router.get('/test-mail', testMail);

export default router;
