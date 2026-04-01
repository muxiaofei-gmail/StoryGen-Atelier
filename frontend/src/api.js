// StoryGenApp/frontend/src/api.js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api';

export const generateStoryboardApi = async (sentence, shotCount, style, testMode = false) => {
  try {
    const response = await fetch(`${API_BASE_URL}/storyboard/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sentence, shotCount, style, test: testMode }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Something went wrong on the server.');
    }

    const data = await response.json();
    return data.storyboard;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

export const generateVideoApi = async (storyboard, testMode = false) => {
  try {
    const response = await fetch(`${API_BASE_URL}/storyboard/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storyboard, test: testMode }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Something went wrong on the server.');
    }

    const data = await response.json();
    return data.videoUrl;
  } catch (error) {
    console.error('API Error (Video):', error);
    throw error;
  }
};

// Gallery APIs
export const listGalleryApi = async () => {
  const response = await fetch(`${API_BASE_URL}/gallery`);
  if (!response.ok) throw new Error('Failed to load gallery');
  const data = await response.json();
  return data.stories || [];
};

export const saveGalleryApi = async (story) => {
  const response = await fetch(`${API_BASE_URL}/gallery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  });
  if (!response.ok) throw new Error('Failed to save story');
  const data = await response.json();
  return data.story;
};

export const deleteGalleryApi = async (id) => {
  const response = await fetch(`${API_BASE_URL}/gallery/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete story');
  const data = await response.json();
  return data.stories || [];
};

// Video Logs APIs
export const listVideoLogsApi = async () => {
  const response = await fetch(`${API_BASE_URL}/video-logs`);
  if (!response.ok) throw new Error('Failed to load video logs');
  const data = await response.json();
  return data.logs || [];
};

export const getVideoLogApi = async (id) => {
  const response = await fetch(`${API_BASE_URL}/video-logs/${id}`);
  if (!response.ok) throw new Error('Failed to load video log');
  const data = await response.json();
  return data.log;
};

export const deleteVideoLogApi = async (id) => {
  const response = await fetch(`${API_BASE_URL}/video-logs/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete video log');
  return true;
};

export const clearVideoLogsApi = async () => {
  const response = await fetch(`${API_BASE_URL}/video-logs`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to clear video logs');
  return true;
};

// Storyboard Logs APIs
export const listStoryboardLogsApi = async () => {
  const response = await fetch(`${API_BASE_URL}/storyboard-logs`);
  if (!response.ok) throw new Error('Failed to load storyboard logs');
  const data = await response.json();
  return data.logs || [];
};

export const getStoryboardLogApi = async (id) => {
  const response = await fetch(`${API_BASE_URL}/storyboard-logs/${id}`);
  if (!response.ok) throw new Error('Failed to load storyboard log');
  const data = await response.json();
  return data.log;
};

export const deleteStoryboardLogApi = async (id) => {
  const response = await fetch(`${API_BASE_URL}/storyboard-logs/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete storyboard log');
  return true;
};

export const clearStoryboardLogsApi = async () => {
  const response = await fetch(`${API_BASE_URL}/storyboard-logs`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to clear storyboard logs');
  return true;
};

export const regenerateShotImageApi = async (shot, style, referenceImageBase64, heroSubject, previousStyleHint) => {
  const response = await fetch(`${API_BASE_URL}/storyboard/regenerate-shot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shot, style, referenceImageBase64, heroSubject, previousStyleHint }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to regenerate image');
  }
  const data = await response.json();
  return data.imageUrl;
};

// ========== 新增：视频生成任务API ==========

// 开始视频生成任务（返回taskId）
export const startVideoGenerationApi = async (storyboard, projectId, testMode = false) => {
  const response = await fetch(`${API_BASE_URL}/storyboard/start-video-generation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyboard, projectId, test: testMode }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to start video generation');
  }
  return response.json();
};

// 查询任务进度
export const getTaskStatusApi = async (taskId) => {
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get task status');
  }
  return response.json();
};

// 查询项目进度
export const getProjectProgressApi = async (projectId) => {
  const response = await fetch(`${API_BASE_URL}/tasks/project/${projectId}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get project progress');
  }
  return response.json();
};

// 重试失败场景
export const retryFailedScenesApi = async (taskId, storyboard) => {
  const response = await fetch(`${API_BASE_URL}/storyboard/retry-failed-scenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, storyboard }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to retry');
  }
  return response.json();
};

// 重新合成视频
export const recomposeVideoApi = async (taskId, storyboard) => {
  const response = await fetch(`${API_BASE_URL}/storyboard/recompose-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, storyboard }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to recompose');
  }
  return response.json();
};

// ========== 项目管理API ==========

// 创建项目
export const createProjectApi = async (topic, storyboard, style) => {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, storyboard, style }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create project');
  }
  return response.json();
};

// 获取项目
export const getProjectApi = async (projectId) => {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get project');
  }
  return response.json();
};

// 获取活跃项目（用于恢复）
export const getActiveProjectApi = async () => {
  const response = await fetch(`${API_BASE_URL}/projects/active`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get active project');
  }
  return response.json();
};

// 更新项目
export const updateProjectApi = async (projectId, updates) => {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to update project');
  }
  return response.json();
};

// 获取项目列表
export const listProjectsApi = async () => {
  const response = await fetch(`${API_BASE_URL}/projects/list`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to list projects');
  }
  return response.json();
};
