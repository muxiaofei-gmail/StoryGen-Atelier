const express = require('express');
const { getTaskStatus, getProjectProgress } = require('../controllers/taskController');

const router = express.Router();

router.get('/:taskId', getTaskStatus);
router.get('/project/:projectId', getProjectProgress);

module.exports = router;