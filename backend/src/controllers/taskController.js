const taskStore = require('../services/taskStore');
const { log } = require('../utils/logger');

// 获取任务进度
exports.getTaskStatus = async (req, res) => {
  const { taskId } = req.params;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const task = taskStore.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 计算进度百分比
    const progress = task.total > 0 ? Math.round((task.current / task.total) * 100) : 0;

    // 统计成功和失败的场景
    const completedScenes = task.sceneResults.filter(s => s.status === 'success').map(s => s.sceneIndex);
    const failedScenes = task.sceneResults.filter(s => s.status === 'failed').map(s => s.sceneIndex);

    res.json({
      id: task.id,
      status: task.status,
      progress: progress,
      current: task.current,
      total: task.total,
      message: task.message,
      completedScenes,
      failedScenes,
      sceneResults: task.sceneResults,
      finalVideoUrl: task.finalVideoUrl,
      errorMessage: task.errorMessage,
    });
  } catch (error) {
    console.error('Error getting task status:', error);
    res.status(500).json({ error: 'Failed to get task status' });
  }
};

// 获取项目进度（通过projectId查询关联的任务）
exports.getProjectProgress = async (req, res) => {
  const { projectId } = req.params;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    const task = taskStore.getTaskByProjectId(projectId);

    if (!task) {
      return res.json({
        status: 'no_task',
        progress: 0,
        message: '暂无生成任务',
      });
    }

    const progress = task.total > 0 ? Math.round((task.current / task.total) * 100) : 0;
    const completedScenes = task.sceneResults.filter(s => s.status === 'success').map(s => s.sceneIndex);
    const failedScenes = task.sceneResults.filter(s => s.status === 'failed').map(s => s.sceneIndex);

    res.json({
      taskId: task.id,
      status: task.status,
      progress: progress,
      current: task.current,
      total: task.total,
      message: task.message,
      completedScenes,
      failedScenes,
      sceneResults: task.sceneResults,
      finalVideoUrl: task.finalVideoUrl,
    });
  } catch (error) {
    console.error('Error getting project progress:', error);
    res.status(500).json({ error: 'Failed to get project progress' });
  }
};