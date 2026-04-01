const crypto = require('crypto');
const taskStore = require('../services/taskStore');

// 获取或创建session ID（简化版，实际应使用真实认证）
const getSessionId = (req) => {
  // 从header或query获取，如果没有则生成一个临时ID
  const headerSession = req.headers['x-session-id'];
  const querySession = req.query.sessionId;

  if (headerSession) return headerSession;
  if (querySession) return querySession;

  // 返回默认session（实际应用中应该从认证系统获取）
  return 'default_session';
};

// 创建项目
exports.createProject = async (req, res) => {
  const { topic, storyboard, style } = req.body;

  if (!storyboard || !Array.isArray(storyboard) || storyboard.length === 0) {
    return res.status(400).json({ error: 'storyboard is required' });
  }

  try {
    const sessionId = getSessionId(req);
    const projectId = taskStore.createProject(sessionId, topic || '未命名项目', storyboard, style);

    const project = taskStore.getProjectById(projectId);

    res.json({
      project,
      message: '项目创建成功',
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

// 获取项目详情
exports.getProject = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    const project = taskStore.getProjectById(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // 同时获取关联的任务进度
    const task = taskStore.getTaskByProjectId(id);

    res.json({
      project,
      task: task || null,
    });
  } catch (error) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
};

// 更新项目
exports.updateProject = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    taskStore.updateProject(id, updates);
    const project = taskStore.getProjectById(id);

    res.json({
      project,
      message: '项目更新成功',
    });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
};

// 获取当前活跃项目（用于恢复）
exports.getActiveProject = async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const project = taskStore.getActiveProjectBySession(sessionId);

    if (!project) {
      return res.json({
        project: null,
        message: '没有进行中的项目',
      });
    }

    // 同时获取任务进度
    const task = taskStore.getTaskByProjectId(project.id);

    res.json({
      project,
      task: task || null,
    });
  } catch (error) {
    console.error('Error getting active project:', error);
    res.status(500).json({ error: 'Failed to get active project' });
  }
};

// 获取用户所有项目列表
exports.listProjects = async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const projects = taskStore.getProjectsBySession(sessionId);

    res.json({
      projects,
      count: projects.length,
    });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
};

// 删除项目
exports.deleteProject = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    taskStore.deleteProject(id);

    res.json({
      message: '项目已删除',
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
};