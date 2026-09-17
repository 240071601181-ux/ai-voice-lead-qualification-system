import { Router } from 'express';
import { getWorkspaceSettings, patchWorkspaceSettings } from '../controllers/settingsController';

const router = Router();

router.get('/', getWorkspaceSettings);
router.patch('/', patchWorkspaceSettings);

export default router;
