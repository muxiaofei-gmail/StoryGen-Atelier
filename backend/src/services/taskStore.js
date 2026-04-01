const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'gallery.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// 确保UTF-8编码
db.pragma('encoding = "UTF-8"');

// 任务表：记录视频生成任务的进度
db.exec(`
  CREATE TABLE IF NOT EXISTS generation_tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    createdAt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    current INTEGER DEFAULT 0,
    message TEXT,
    sceneResults TEXT,
    finalVideoUrl TEXT,
    errorMessage TEXT
  );
`);

// 项目表：记录用户项目状态（用于恢复）
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    topic TEXT,
    storyboard TEXT,
    style TEXT,
    taskId TEXT,
    status TEXT DEFAULT 'draft',
    progress INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const generateId = () => `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const generateProjectId = () => `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ========== 任务相关 ==========

const toTask = (row) => ({
  id: row.id,
  projectId: row.projectId,
  createdAt: row.createdAt,
  status: row.status,
  progress: row.progress,
  total: row.total,
  current: row.current,
  message: row.message,
  sceneResults: JSON.parse(row.sceneResults || '[]'),
  finalVideoUrl: row.finalVideoUrl,
  errorMessage: row.errorMessage,
});

exports.createTask = (projectId, total) => {
  const id = generateId();
  const createdAt = new Date().toISOString();
  const sceneResults = [];

  db.prepare(
    `INSERT INTO generation_tasks (id, projectId, createdAt, status, total, sceneResults)
     VALUES (@id, @projectId, @createdAt, @status, @total, @sceneResults)`
  ).run({
    id,
    projectId,
    createdAt,
    status: 'running',
    total,
    sceneResults: JSON.stringify(sceneResults),
  });

  return id;
};

exports.updateTask = (id, updates) => {
  const fields = [];
  const params = { id };

  if (updates.status !== undefined) {
    fields.push('status = @status');
    params.status = updates.status;
  }
  if (updates.progress !== undefined) {
    fields.push('progress = @progress');
    params.progress = updates.progress;
  }
  if (updates.current !== undefined) {
    fields.push('current = @current');
    params.current = updates.current;
  }
  if (updates.total !== undefined) {
    fields.push('total = @total');
    params.total = updates.total;
  }
  if (updates.message !== undefined) {
    fields.push('message = @message');
    params.message = updates.message;
  }
  if (updates.sceneResults !== undefined) {
    fields.push('sceneResults = @sceneResults');
    params.sceneResults = JSON.stringify(updates.sceneResults);
  }
  if (updates.finalVideoUrl !== undefined) {
    fields.push('finalVideoUrl = @finalVideoUrl');
    params.finalVideoUrl = updates.finalVideoUrl;
  }
  if (updates.errorMessage !== undefined) {
    fields.push('errorMessage = @errorMessage');
    params.errorMessage = updates.errorMessage;
  }

  if (fields.length > 0) {
    db.prepare(`UPDATE generation_tasks SET ${fields.join(', ')} WHERE id = @id`).run(params);
  }
};

exports.getTaskById = (id) => {
  const row = db.prepare('SELECT * FROM generation_tasks WHERE id = ?').get(id);
  return row ? toTask(row) : null;
};

exports.getTaskByProjectId = (projectId) => {
  const row = db.prepare('SELECT * FROM generation_tasks WHERE projectId = ? ORDER BY datetime(createdAt) DESC LIMIT 1').get(projectId);
  return row ? toTask(row) : null;
};

// ========== 项目相关 ==========

const toProject = (row) => ({
  id: row.id,
  sessionId: row.sessionId,
  topic: row.topic,
  storyboard: JSON.parse(row.storyboard || '[]'),
  style: row.style,
  taskId: row.taskId,
  status: row.status,
  progress: row.progress,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

exports.createProject = (sessionId, topic, storyboard, style) => {
  const id = generateProjectId();
  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  db.prepare(
    `INSERT INTO projects (id, sessionId, topic, storyboard, style, status, createdAt, updatedAt)
     VALUES (@id, @sessionId, @topic, @storyboard, @style, @status, @createdAt, @updatedAt)`
  ).run({
    id,
    sessionId,
    topic,
    storyboard: JSON.stringify(storyboard || []),
    style: style || null,
    status: 'draft',
    createdAt,
    updatedAt,
  });

  return id;
};

exports.updateProject = (id, updates) => {
  const fields = [];
  const params = { id };

  if (updates.topic !== undefined) {
    fields.push('topic = @topic');
    params.topic = updates.topic;
  }
  if (updates.storyboard !== undefined) {
    fields.push('storyboard = @storyboard');
    params.storyboard = JSON.stringify(updates.storyboard);
  }
  if (updates.style !== undefined) {
    fields.push('style = @style');
    params.style = updates.style;
  }
  if (updates.taskId !== undefined) {
    fields.push('taskId = @taskId');
    params.taskId = updates.taskId;
  }
  if (updates.status !== undefined) {
    fields.push('status = @status');
    params.status = updates.status;
  }
  if (updates.progress !== undefined) {
    fields.push('progress = @progress');
    params.progress = updates.progress;
  }

  fields.push('updatedAt = @updatedAt');
  params.updatedAt = new Date().toISOString();

  if (fields.length > 0) {
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = @id`).run(params);
  }
};

exports.getProjectById = (id) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? toProject(row) : null;
};

exports.getActiveProjectBySession = (sessionId) => {
  // 查询进行中的项目，或者最近完成的但可能有未合成场景的项目
  const row = db.prepare(
    `SELECT * FROM projects WHERE sessionId = ? AND status IN ('draft', 'generating', 'completed') ORDER BY datetime(updatedAt) DESC LIMIT 1`
  ).get(sessionId);
  return row ? toProject(row) : null;
};

exports.getProjectsBySession = (sessionId) => {
  const rows = db.prepare(
    `SELECT * FROM projects WHERE sessionId = ? ORDER BY datetime(updatedAt) DESC LIMIT 20`
  ).all(sessionId);
  return rows.map(toProject);
};

exports.deleteProject = (id) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
};