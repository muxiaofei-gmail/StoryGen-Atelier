const express = require('express');
const {
  createProject,
  getProject,
  updateProject,
  getActiveProject,
  listProjects,
  deleteProject,
} = require('../controllers/projectController');

const router = express.Router();

router.post('/', createProject);
router.get('/active', getActiveProject);
router.get('/list', listProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

module.exports = router;