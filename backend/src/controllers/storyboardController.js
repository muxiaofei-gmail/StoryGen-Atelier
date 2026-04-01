const llmService = require('../services/llmService');
const imageGenService = require('../services/imageGenService');
const videoService = require('../services/videoService');
const storyboardLogStore = require('../services/storyboardLogStore');
const taskStore = require('../services/taskStore');
const { log } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// 测试模式数据路径
const DATA_DIR = path.join(__dirname, '../../data');
const STORYBOARD_FILE = path.join(DATA_DIR, 'storyboard_result.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
const BASE_URL = 'http://localhost:3005';

exports.generateStoryboard = async (req, res) => {
  const { sentence, style, test, shotCount } = req.body;

  // 测试模式：返回预生成的数据
  if (test === true || test === 'true') {
    console.log('[TEST MODE] Returning pre-generated storyboard data');

    try {
      // 读取预生成的脚本
      const storyboardData = JSON.parse(fs.readFileSync(STORYBOARD_FILE, 'utf-8'));

      // 为每个场景添加图片URL（完整URL）
      const storyboardWithImages = storyboardData.map(shot => {
        const imagePath = path.join(IMAGES_DIR, `scene${shot.shot}.png`);
        const imageUrl = fs.existsSync(imagePath)
          ? `${BASE_URL}/images/scene${shot.shot}.png`
          : null;
        return { ...shot, imageUrl };
      });

      console.log(`[TEST MODE] Returning ${storyboardWithImages.length} shots with images`);
      return res.json({ storyboard: storyboardWithImages });
    } catch (err) {
      console.error('[TEST MODE] Error:', err);
      return res.status(500).json({ error: 'Test data not available' });
    }
  }

  if (!sentence) {
    return res.status(400).json({ error: 'Sentence is required' });
  }

  // shotCount: null 表示AI自动判断，数字表示用户指定
  const startTime = Date.now();
  const logId = storyboardLogStore.createLog({
    sentence,
    requestedShots: shotCount || 'auto',
    style,
    model: process.env.TONGYI_MODEL || "qwen-plus",
  });

  try {
    log('storyboard_generate_start', { sentencePreview: sentence.slice(0, 80), requestedShots: shotCount || 'auto', style, storyboardLogId: logId });

    // Step 1: Generate storyboard prompts using LLM service
    // shotCount: null = AI auto-determine, number = user specified
    const storyboardPrompts = await llmService.generatePrompts(sentence, shotCount, style);

    // Step 2: Generate images for each prompt using image generation service
    // 风格一致性通过 prompt 中的风格前缀保证，不需要参考图片
    const storyboardWithImages = [];
    let heroSubject = '';

    // Extract heroSubject from first shot if available
    if (storyboardPrompts.length > 0 && storyboardPrompts[0].heroSubject) {
      heroSubject = storyboardPrompts[0].heroSubject;
    }

    for (let i = 0; i < storyboardPrompts.length; i++) {
      const shot = storyboardPrompts[i];
      let imageUrl = shot.imageUrl;
      if (!imageUrl) {
        // 所有图片使用相同的风格前缀，确保风格一致
        imageUrl = await imageGenService.generateImage(
          shot.prompt,
          "",  // previousStyleHint - 不再需要
          style,
          null,  // referenceImageBase64 - 不再使用参考图
          heroSubject
        );
      }
      storyboardWithImages.push({ ...shot, imageUrl });
    }

    const duration = Date.now() - startTime;
    storyboardLogStore.updateLog(logId, {
      status: 'completed',
      storyboard: storyboardWithImages,
      generatedShots: storyboardWithImages.length,
      duration,
    });

    log('storyboard_generate_success', { shots: storyboardWithImages.length, style, requestedShots: 'auto', storyboardLogId: logId });

    res.json({ storyboard: storyboardWithImages });
  } catch (error) {
    console.error('Error generating storyboard:', error);
    const duration = Date.now() - startTime;
    storyboardLogStore.updateLog(logId, {
      status: 'error',
      errorMessage: error.message,
      duration,
    });
    log('storyboard_generate_error', { message: error.message, storyboardLogId: logId });
    res.status(500).json({ error: 'Failed to generate storyboard' });
  }
};

exports.generateVideoFromStoryboard = async (req, res) => {
  const { storyboard, test } = req.body;

  // 测试模式：返回预生成的视频URL
  if (test === true || test === 'true') {
    console.log('[TEST MODE] Returning pre-generated video');

    const finalVideoPath = path.join(VIDEOS_DIR, 'final_video.mp4');
    if (fs.existsSync(finalVideoPath)) {
      const videoUrl = `${BASE_URL}/videos/final_video.mp4`;
      console.log(`[TEST MODE] Returning video: ${videoUrl}`);
      return res.json({ videoUrl });
    } else {
      console.error('[TEST MODE] Final video not found');
      return res.status(500).json({ error: 'Test video not available' });
    }
  }

  if (!storyboard || !Array.isArray(storyboard) || storyboard.length === 0) {
    return res.status(400).json({ error: 'Valid storyboard is required' });
  }

  try {
    log('generate_video_from_storyboard_start', { shots: storyboard.length });
    
    // Use the new full video generation logic (Interpolation Chain)
    // This replaces the old planSegments + generateSequencedVideo flow
    const videoUrl = await videoService.generateFullVideoFromShots(storyboard);
    
    log('generate_video_from_storyboard_success', { shots: storyboard.length, videoUrl });
    res.json({ videoUrl });
  } catch (error) {
    console.error('Error generating video:', error);
    res.status(500).json({ error: error.message || 'Failed to generate video' });
  }
};

// Deprecated/Legacy endpoints - can be removed or stubbed
exports.planChunks = async (req, res) => {
    res.status(410).json({ error: "Endpoint deprecated. Auto-planning is now internal." });
};

exports.generateVideosForSegments = async (req, res) => {
     res.status(410).json({ error: "Endpoint deprecated. Use generateVideoFromStoryboard." });
};

exports.stitchVideos = async (req, res) => {
    // Keep stitch endpoint if frontend uses it separately, otherwise deprecate
  const { videoUrls } = req.body;
  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: 'videoUrls array is required' });
  }
  try {
    const stitchedUrl = await videoService.stitchVideos(videoUrls);
    log('stitch_request', { parts: videoUrls.length, stitchedUrl });
    res.json({ stitchedUrl });
  } catch (error) {
    console.error('Error stitching videos:', error);
    res.status(500).json({ error: error.message || 'Failed to stitch videos' });
  }
};

exports.regenerateShotImage = async (req, res) => {
  const { shot, style, referenceImageBase64, heroSubject, previousStyleHint } = req.body;

  if (!shot || !shot.prompt) {
    return res.status(400).json({ error: 'Shot with prompt is required' });
  }

  try {
    const imageUrl = await imageGenService.generateImage(
      shot.prompt,
      previousStyleHint || '',
      style || '',
      referenceImageBase64 || null,
      heroSubject || ''
    );

    res.json({ imageUrl });
  } catch (error) {
    console.error('Error regenerating shot image:', error);
    res.status(500).json({ error: 'Failed to regenerate image' });
  }
};

// ========== 新增：带项目管理的视频生成 ==========

// 开始视频生成任务（返回taskId用于查询进度）
exports.startVideoGeneration = async (req, res) => {
  const { storyboard, projectId, test } = req.body;

  // 测试模式
  if (test === true || test === 'true') {
    console.log('[TEST MODE] Returning pre-generated video');
    const finalVideoPath = path.join(VIDEOS_DIR, 'final_video.mp4');
    if (fs.existsSync(finalVideoPath)) {
      return res.json({
        videoUrl: `${BASE_URL}/videos/final_video.mp4`,
        taskId: 'test_task',
        projectId: 'test_project'
      });
    }
    return res.status(500).json({ error: 'Test video not available' });
  }

  if (!storyboard || !Array.isArray(storyboard) || storyboard.length === 0) {
    return res.status(400).json({ error: 'Valid storyboard is required' });
  }

  try {
    // 创建或获取项目
    let actualProjectId = projectId;
    if (!actualProjectId) {
      const sessionId = req.headers['x-session-id'] || 'default_session';
      actualProjectId = taskStore.createProject(sessionId, '', storyboard, '');
    } else {
      // 更新现有项目
      taskStore.updateProject(actualProjectId, {
        storyboard,
        status: 'generating',
        progress: 0
      });
    }

    // 创建任务
    const taskId = taskStore.createTask(actualProjectId, storyboard.length);

    // 更新项目关联
    taskStore.updateProject(actualProjectId, {
      taskId,
      status: 'generating'
    });

    // 异步开始生成（不等待完成）
    videoService.generateVideoWithProgress(storyboard, actualProjectId, taskId)
      .then(result => {
        log('video_generation_complete', { taskId, projectId: actualProjectId });
      })
      .catch(error => {
        log('video_generation_error', { taskId, error: error.message });
      });

    log('video_generation_started', { taskId, projectId: actualProjectId, shots: storyboard.length });

    res.json({
      taskId,
      projectId: actualProjectId,
      message: '视频生成任务已启动'
    });

  } catch (error) {
    console.error('Error starting video generation:', error);
    res.status(500).json({ error: error.message || 'Failed to start video generation' });
  }
};

// 重试失败的场景
exports.retryFailedScenes = async (req, res) => {
  const { taskId, storyboard } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  if (!storyboard || !Array.isArray(storyboard)) {
    return res.status(400).json({ error: 'storyboard is required' });
  }

  try {
    const result = await videoService.retryFailedScenes(storyboard, taskId);
    res.json(result);
  } catch (error) {
    console.error('Error retrying failed scenes:', error);
    res.status(500).json({ error: error.message || 'Failed to retry' });
  }
};

// 重新合成视频
exports.recomposeVideo = async (req, res) => {
  const { taskId, storyboard } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const result = await videoService.recomposeVideo(storyboard, taskId);
    res.json(result);
  } catch (error) {
    console.error('Error recomposing video:', error);
    res.status(500).json({ error: error.message || 'Failed to recompose' });
  }
};
