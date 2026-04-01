const fs = require('fs');
const path = require('path');
const { fetch } = require('undici');
const { log } = require('../utils/logger');
const videoLogStore = require('./videoLogStore');
const taskStore = require('./taskStore');
const ttsService = require('./ttsService');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../../data');
const videoDir = path.join(dataDir, 'videos');
const audioDir = path.join(dataDir, 'audio');

// SiliconFlow 配置（视频生成）
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1';
const SILICONFLOW_VIDEO_MODEL = process.env.SILICONFLOW_VIDEO_MODEL || 'Wan-AI/Wan2.2-I2V-A14B';

// Kling 配置（备用）
const KLING_API_URL = process.env.KLING_BASE_URL || 'https://api-beijing.klingai.com';
const KLING_VIDEO_MODEL = process.env.KLING_VIDEO_MODEL || 'kling-v1';

const ensureDirs = () => {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
};

// ========== 音频处理辅助函数 ==========

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
let ffprobePath;
try {
  ffprobePath = require('@ffprobe-installer/ffprobe').path;
} catch (e) {
  ffprobePath = null;
}
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

/**
 * 获取视频或音频文件的时长（秒）
 * @param {string} filePath - 文件路径
 * @returns {Promise<number>} - 时长（秒）
 */
const getMediaDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data.format.duration);
    });
  });
};

/**
 * 为音频添加前置和后置静音，使其居中播放且总时长与视频匹配
 * @param {string} audioPath - 原音频路径
 * @param {number} targetDuration - 目标时长（视频时长，秒）
 * @param {string} outputPath - 输出音频路径
 * @returns {Promise<string>} - 输出音频路径
 */
const padAudioCentered = async (audioPath, targetDuration, outputPath) => {
  const audioDuration = await getMediaDuration(audioPath);

  // 如果音频时长 >= 视频时长，直接返回原音频
  if (audioDuration >= targetDuration) {
    return audioPath;
  }

  // 计算前置和后置静音时长（居中）
  const paddingTotal = targetDuration - audioDuration;
  const prePadding = paddingTotal / 2;
  const postPadding = paddingTotal / 2;

  log('audio_padding', {
    audioPath,
    audioDuration,
    targetDuration,
    prePadding,
    postPadding
  });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=channel_layout=mono:sample_rate=44100')  // 生成静音
      .inputOptions(['-f', 'lavfi', '-t', prePadding.toString()])
      .input(audioPath)
      .input('anullsrc=channel_layout=mono:sample_rate=44100')  // 生成静音
      .inputOptions(['-f', 'lavfi', '-t', postPadding.toString()])
      .complexFilter([
        '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]'
      ], 'out')
      .outputOptions(['-c:a', 'libmp3lame', '-q:a', '2'])
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
};

/**
 * 处理多个音频，为每个添加居中静音填充
 * @param {Array} successScenes - 成功的场景列表，包含 videoPath 和 audioPath
 * @returns {Promise<Array>} - 处理后的音频路径数组
 */
const processAudiosWithPadding = async (successScenes) => {
  const paddedAudioPaths = [];

  for (const scene of successScenes) {
    if (!scene.audioPath || !scene.videoPath) {
      paddedAudioPaths.push(null);
      continue;
    }

    try {
      // 检查音频文件是否存在
      if (!fs.existsSync(scene.audioPath)) {
        log('audio_file_not_found', { audioPath: scene.audioPath });
        paddedAudioPaths.push(null);
        continue;
      }

      // 获取视频时长
      const videoDuration = await getMediaDuration(scene.videoPath);

      // 生成填充后的音频文件名
      const paddedAudioName = `padded_scene${scene.sceneIndex + 1}_${Date.now()}.mp3`;
      const paddedAudioPath = path.join(audioDir, paddedAudioName);

      // 添加居中静音填充
      const resultPath = await padAudioCentered(scene.audioPath, videoDuration, paddedAudioPath);
      paddedAudioPaths.push(resultPath);

      log('audio_padding_complete', {
        sceneIndex: scene.sceneIndex,
        originalPath: scene.audioPath,
        paddedPath: resultPath
      });

    } catch (error) {
      log('audio_padding_error', {
        sceneIndex: scene.sceneIndex,
        error: error.message
      });
      paddedAudioPaths.push(null);
    }
  }

  return paddedAudioPaths;
};

// SiliconFlow 视频生成（Wan-AI/Wan2.2-I2V）
const generateClipWithSiliconFlow = async ({ prompt, imageUrl, durationSeconds = 5 }) => {
  if (!SILICONFLOW_API_KEY) {
    throw new Error('SiliconFlow API Key not configured');
  }

  ensureDirs();

  // 读取图片为 base64
  let imageBase64;
  if (imageUrl) {
    if (imageUrl.startsWith('data:')) {
      // 已经是 base64
      const match = imageUrl.match(/^data:.+;base64,(.+)$/);
      if (match) imageBase64 = match[1];
    } else if (imageUrl.startsWith('http')) {
      // 从 URL 下载
      const res = await fetch(imageUrl);
      const buffer = Buffer.from(await res.arrayBuffer());
      imageBase64 = buffer.toString('base64');
    } else if (fs.existsSync(imageUrl)) {
      // 本地文件
      imageBase64 = fs.readFileSync(imageUrl).toString('base64');
    }
  }

  if (!imageBase64) {
    throw new Error('No valid image provided for I2V');
  }

  log('siliconflow_video_submit', { model: SILICONFLOW_VIDEO_MODEL });

  // 提交视频生成任务
  const submitResponse = await fetch(`${SILICONFLOW_BASE_URL}/video/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: SILICONFLOW_VIDEO_MODEL,
      prompt: prompt || 'A cartoon scene with movement',
      image: imageBase64
    })
  });

  if (!submitResponse.ok) {
    const text = await submitResponse.text();
    throw new Error(`SiliconFlow submit error: ${submitResponse.status} ${text}`);
  }

  const submitData = await submitResponse.json();
  const requestId = submitData.requestId;

  if (!requestId) {
    throw new Error('No requestId returned');
  }

  log('siliconflow_task_created', { requestId });

  // 轮询任务状态
  const maxAttempts = 120;  // 约12分钟
  const delayMs = 5000;     // 5秒间隔

  for (let i = 0; i < maxAttempts; i++) {
    const statusResponse = await fetch(`${SILICONFLOW_BASE_URL}/video/status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requestId })
    });

    if (!statusResponse.ok) {
      log('siliconflow_status_error', { status: statusResponse.status });
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    const statusData = await statusResponse.json();

    // 成功
    if (statusData.status === 'Succeed' && statusData.results?.videos?.[0]?.url) {
      log('siliconflow_task_succeed', { requestId, attempt: i + 1 });

      const videoUrl = statusData.results.videos[0].url;

      // 下载视频
      const fileName = `clip_sf_${Date.now()}.mp4`;
      const outPath = path.join(videoDir, fileName);

      const videoRes = await fetch(videoUrl);
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      await fs.promises.writeFile(outPath, videoBuffer);

      log('siliconflow_video_saved', { path: outPath, size: videoBuffer.length });
      return { video_path: outPath, provider: 'siliconflow' };
    }

    // 失败
    if (statusData.status === 'Failed') {
      throw new Error(`SiliconFlow video failed: ${statusData.reason || 'unknown'}`);
    }

    // 进行中
    log('siliconflow_task_progress', { requestId, status: statusData.status, attempt: i + 1 });
    await new Promise(r => setTimeout(r, delayMs));
  }

  throw new Error('SiliconFlow video generation timed out');
};

// Kling 认证：生成JWT Token
const generateKlingToken = () => {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey || !secretKey) {
    return null;
  }

  // JWT Header
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  // JWT Payload (按文档要求，不需要iat)
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,        // issuer: accessKey
    exp: now + 1800,       // expiration: 30分钟后
    nbf: now - 5           // not before: 5秒前
  };

  // Base64URL 编码
  const base64urlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const encodedHeader = base64urlEncode(header);
  const encodedPayload = base64urlEncode(payload);

  // HMAC-SHA256 签名
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

// 读取图片数据（支持URL和base64）
const readImageBytes = async (imageUrl) => {
  if (!imageUrl) return null;

  // Base64 data URI
  const DATA_URL_REGEX = /^data:(.+?);base64,(.+)$/;
  const dataMatch = DATA_URL_REGEX.exec(imageUrl);
  if (dataMatch) {
    return { bytesBase64Encoded: dataMatch[2], mimeType: dataMatch[1] || 'image/png' };
  }

  // HTTP URL
  if (imageUrl.startsWith('http')) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { bytesBase64Encoded: buffer.toString('base64'), mimeType: res.headers.get('content-type') || 'image/png' };
  }

  return null;
};

// Kling 视频生成（带音频）
const generateClipWithKling = async ({ prompt, firstFrameUrl, durationSeconds }) => {
  const token = generateKlingToken();
  if (!token) {
    throw new Error('Kling credentials not configured');
  }

  // 读取首帧图片
  const imageData = await readImageBytes(firstFrameUrl);

  // 创建视频生成任务
  log('kling_video_create', { model: KLING_VIDEO_MODEL, duration: durationSeconds });

  const requestBody = {
    model: KLING_VIDEO_MODEL,
    prompt: prompt,
    duration: durationSeconds,
    aspect_ratio: '16:9'
  };

  // 如果有图片，添加首帧
  if (imageData) {
    requestBody.image = imageData.bytesBase64Encoded;
  }

  const createResponse = await fetch(`${KLING_API_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!createResponse.ok) {
    const text = await createResponse.text();
    throw new Error(`Kling create error: ${createResponse.status} ${text}`);
  }

  const createData = await createResponse.json();
  const taskId = createData.task_id || createData.data?.task_id;

  if (!taskId) {
    // 直接返回视频URL（某些情况）
    if (createData.data && createData.data[0]?.video_url) {
      return { video_url: createData.data[0].video_url, provider: 'kling' };
    }
    throw new Error('No task_id returned from Kling');
  }

  log('kling_task_created', { taskId });

  // 轮询任务状态
  const maxAttempts = 60;  // 约10分钟
  const delayMs = 10000;   // 10秒间隔

  for (let i = 0; i < maxAttempts; i++) {
    const queryToken = generateKlingToken();

    const queryResponse = await fetch(`${KLING_API_URL}/v1/videos/generations/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${queryToken}`
      }
    });

    if (!queryResponse.ok) {
      const text = await queryResponse.text();
      log('kling_query_error', { status: queryResponse.status, message: text });
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    const queryData = await queryResponse.json();

    if (queryData.status === 'succeed' || queryData.task_status === 'succeed') {
      log('kling_task_succeed', { taskId });

      // 获取视频URL
      const videoData = queryData.data?.[0] || queryData.task_result?.videos?.[0];
      const videoUrl = videoData?.url || videoData?.video_url;

      if (!videoUrl) {
        throw new Error('No video_url in response');
      }

      // 下载视频到本地
      const fileName = `clip_kling_${Date.now()}.mp4`;
      const outPath = path.join(videoDir, fileName);

      const videoRes = await fetch(videoUrl);
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      await fs.promises.writeFile(outPath, videoBuffer);

      log('kling_video_saved', { path: outPath });
      return { video_path: outPath, provider: 'kling' };
    }

    if (queryData.status === 'failed' || queryData.task_status === 'failed') {
      throw new Error(`Kling video failed: ${queryData.message || 'unknown error'}`);
    }

    // 任务进行中
    log('kling_task_progress', { taskId, status: queryData.status || queryData.task_status, attempt: i + 1 });
    await new Promise(r => setTimeout(r, delayMs));
  }

  throw new Error('Kling video generation timed out');
};

// 主函数：生成完整视频（含配音）
exports.generateFullVideoFromShots = async (storyboard) => {
  ensureDirs();
  const startTime = Date.now();

  const logId = videoLogStore.createLog(storyboard);
  log('video_generation_start', { shot_count: storyboard.length, logId });

  if (!storyboard || storyboard.length < 2) {
    const error = "需要至少2个场景才能生成视频";
    videoLogStore.updateLog(logId, { status: 'error', errorMessage: error });
    throw new Error(error);
  }

  // 检查使用哪个视频服务
  const useSiliconFlow = SILICONFLOW_API_KEY;
  const useKling = process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY;

  if (!useSiliconFlow && !useKling) {
    throw new Error('请配置 SILICONFLOW_API_KEY 或 KLING_ACCESS_KEY/KLING_SECRET_KEY');
  }

  try {
    // --- PHASE 1: 生成配音 ---
    log('audio_generation_start', { count: storyboard.length });

    const audioPaths = await ttsService.generateAllAudio(storyboard);
    const validAudioPaths = audioPaths.filter(p => p !== null);

    log('audio_generation_complete', { success: validAudioPaths.length });

    // --- PHASE 2: 生成视频片段 ---
    const clipPromises = storyboard.map(async (shot, index) => {
      log('generating_clip_start', { index, shot: shot.shot });

      try {
        // 优先使用 SiliconFlow
        if (useSiliconFlow) {
          const result = await generateClipWithSiliconFlow({
            prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
            imageUrl: shot.imageUrl,
            durationSeconds: parseInt(shot.duration) || 5
          });
          return { index, videoPath: result.video_path, provider: 'siliconflow', audioPath: audioPaths[index] };
        }

        // 备用 Kling
        if (useKling) {
          const result = await generateClipWithKling({
            prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
            firstFrameUrl: shot.imageUrl,
            durationSeconds: parseInt(shot.duration) || 5
          });
          return { index, videoPath: result.video_path, provider: 'kling', audioPath: audioPaths[index] };
        }

      } catch (error) {
        log('clip_gen_error', { index, error: error.message });
        throw error;
      }
    });

    // 串行生成（视频生成耗时长，避免并发）
    const clipResults = [];
    for (const promise of clipPromises) {
      const result = await promise;
      clipResults.push(result);
      log('clip_complete', { index: result.index });
    }

    clipResults.sort((a, b) => a.index - b.index);

    const videoFiles = clipResults.map(r => r.videoPath).filter(Boolean);
    videoLogStore.updateLog(logId, { status: 'stitching', clipResults });

    // --- PHASE 3: FFmpeg拼接（含配音） ---
    log('stitching_videos', { files: videoFiles.length, audioFiles: validAudioPaths.length });

    const outputName = `full_story_${Date.now()}.mp4`;
    const outputPath = path.join(videoDir, outputName);

    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    let ffprobePath;
    try {
      ffprobePath = require('@ffprobe-installer/ffprobe').path;
    } catch (e) {
      ffprobePath = null;
    }
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

    // 如果有配音，需要合并音频
    if (validAudioPaths.length > 0) {
      // 先合并所有音频
      const combinedAudioPath = path.join(audioDir, `combined_${Date.now()}.mp3`);

      // 使用 ffmpeg 合并音频
      await new Promise((resolve, reject) => {
        const command = ffmpeg();

        validAudioPaths.forEach((audioPath, i) => {
          command.input(audioPath);
        });

        command
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .mergeToFile(combinedAudioPath, audioDir);
      });

      // 拼接视频并添加音频
      const concatListPath = path.join(videoDir, `concat_list_${Date.now()}.txt`);
      const concatContent = videoFiles.map(f => `file '${f}'`).join('\n');
      await fs.promises.writeFile(concatListPath, concatContent);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .input(combinedAudioPath)
          .outputOptions([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v',
            '-map', '1:a',
            '-shortest'
          ])
          .on('end', () => {
            log('ffmpeg_stitch_with_audio_complete', { outputPath });
            resolve();
          })
          .on('error', (err) => {
            log('ffmpeg_stitch_error', { error: err.message });
            reject(err);
          })
          .save(outputPath);
      });

    } else {
      // 无配音，仅拼接视频
      const concatListPath = path.join(videoDir, `concat_list_${Date.now()}.txt`);
      const concatContent = videoFiles.map(f => `file '${f}'`).join('\n');
      await fs.promises.writeFile(concatListPath, concatContent);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .on('end', () => {
            log('ffmpeg_stitch_complete', { outputPath });
            resolve();
          })
          .on('error', (err) => {
            log('ffmpeg_stitch_error', { error: err.message });
            reject(err);
          })
          .save(outputPath);
      });
    }

    const finalVideoUrl = `http://localhost:${process.env.PORT || 3005}/videos/${outputName}`;
    const duration = Date.now() - startTime;

    videoLogStore.updateLog(logId, {
      status: 'completed',
      finalVideoUrl,
      duration
    });

    log('full_video_complete', { output: outputPath, logId, duration });
    return finalVideoUrl;

  } catch (error) {
    const duration = Date.now() - startTime;
    videoLogStore.updateLog(logId, {
      status: 'error',
      errorMessage: error.message,
      duration
    });
    throw error;
  }
};

// 向后兼容
exports.generateVideo = async (storyboard) => {
  return exports.generateFullVideoFromShots(storyboard);
};

// ========== 新增：带进度跟踪的视频生成 ==========

// 生成带进度跟踪的视频（支持项目恢复）
exports.generateVideoWithProgress = async (storyboard, projectId, taskId) => {
  ensureDirs();
  const startTime = Date.now();
  const total = storyboard.length;

  log('video_generation_with_progress_start', { shot_count: total, projectId, taskId });

  // 检查使用哪个视频服务
  const useSiliconFlow = SILICONFLOW_API_KEY;
  const useKling = process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY;

  if (!useSiliconFlow && !useKling) {
    throw new Error('请配置 SILICONFLOW_API_KEY 或 KLING_ACCESS_KEY/KLING_SECRET_KEY');
  }

  const sceneResults = [];

  try {
    // 更新任务状态
    taskStore.updateTask(taskId, {
      status: 'running',
      total,
      current: 0,
      message: '正在生成配音...',
      sceneResults: []
    });

    // --- PHASE 1: 生成配音 ---
    log('audio_generation_start', { count: total });
    const audioPaths = await ttsService.generateAllAudio(storyboard);
    log('audio_generation_complete', { success: audioPaths.filter(p => p).length });

    // --- PHASE 2: 串行生成视频片段 ---
    taskStore.updateTask(taskId, {
      message: '正在生成视频片段...',
    });

    for (let index = 0; index < storyboard.length; index++) {
      const shot = storyboard[index];
      const sceneResult = {
        sceneIndex: index,
        shot: shot.shot,
        status: 'pending',
        videoPath: null,
        audioPath: audioPaths[index] || null,
        error: null
      };

      try {
        log('generating_clip_start', { index, shot: shot.shot });

        let result;
        if (useSiliconFlow) {
          result = await generateClipWithSiliconFlow({
            prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
            imageUrl: shot.imageUrl,
            durationSeconds: parseInt(shot.duration) || 5
          });
        } else if (useKling) {
          result = await generateClipWithKling({
            prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
            firstFrameUrl: shot.imageUrl,
            durationSeconds: parseInt(shot.duration) || 5
          });
        }

        sceneResult.status = 'success';
        sceneResult.videoPath = result.video_path;
        sceneResult.provider = result.provider;

        log('clip_complete', { index, shot: shot.shot });

      } catch (error) {
        log('clip_gen_error', { index, shot: shot.shot, error: error.message });
        sceneResult.status = 'failed';
        sceneResult.error = error.message;
      }

      sceneResults.push(sceneResult);

      // 更新进度
      const current = index + 1;
      const progress = Math.round((current / total) * 80); // 80%用于视频生成
      taskStore.updateTask(taskId, {
        current,
        progress,
        message: `正在生成第 ${current}/${total} 个视频片段...`,
        sceneResults: [...sceneResults]
      });
    }

    // 检查是否有成功的场景
    const successScenes = sceneResults.filter(s => s.status === 'success');
    const failedScenes = sceneResults.filter(s => s.status === 'failed');

    if (successScenes.length === 0) {
      throw new Error('所有视频片段生成失败，请重试');
    }

    // --- PHASE 3: FFmpeg拼接 ---
    taskStore.updateTask(taskId, {
      progress: 85,
      message: '正在处理音频...'
    });

    const videoFiles = successScenes.map(s => s.videoPath).filter(Boolean);

    log('stitching_videos', { files: videoFiles.length, scenes: successScenes.length });

    const outputName = `full_story_${Date.now()}.mp4`;
    const outputPath = path.join(videoDir, outputName);

    // 处理音频：为每个音频添加居中静音填充，使其时长与对应视频匹配
    const paddedAudioPaths = await processAudiosWithPadding(successScenes);
    const validPaddedAudioPaths = paddedAudioPaths.filter(p => p !== null);

    // 拼接视频
    const concatListPath = path.join(videoDir, `concat_list_${Date.now()}.txt`);
    const concatContent = videoFiles.map(f => `file '${f}'`).join('\n');
    await fs.promises.writeFile(concatListPath, concatContent);

    taskStore.updateTask(taskId, {
      progress: 90,
      message: '正在合成视频...'
    });

    if (validPaddedAudioPaths.length > 0) {
      // 合并填充后的音频
      const combinedAudioPath = path.join(audioDir, `combined_${Date.now()}.mp3`);

      await new Promise((resolve, reject) => {
        const command = ffmpeg();
        validPaddedAudioPaths.forEach((audioPath) => {
          command.input(audioPath);
        });
        command
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .mergeToFile(combinedAudioPath, audioDir);
      });

      // 视频音频合并（不再需要 -shortest，因为音频时长已与视频匹配）
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .input(combinedAudioPath)
          .outputOptions([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v',
            '-map', '1:a'
          ])
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outputPath);
      });

    } else {
      // 仅视频
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outputPath);
      });
    }

    const finalVideoUrl = `http://localhost:${process.env.PORT || 3005}/videos/${outputName}`;
    const duration = Date.now() - startTime;

    // 更新任务完成
    taskStore.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      finalVideoUrl,
      message: failedScenes.length > 0
        ? `生成完成（${failedScenes.length}个场景失败）`
        : '生成完成'
    });

    // 更新项目状态
    if (projectId) {
      taskStore.updateProject(projectId, {
        status: 'completed',
        progress: 100
      });
    }

    log('full_video_complete', { output: outputPath, taskId, duration });

    return {
      videoUrl: finalVideoUrl,
      successCount: successScenes.length,
      failedCount: failedScenes.length,
      sceneResults
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    taskStore.updateTask(taskId, {
      status: 'failed',
      errorMessage: error.message
    });

    if (projectId) {
      taskStore.updateProject(projectId, {
        status: 'failed'
      });
    }

    throw error;
  }
};

// 重试失败的场景
exports.retryFailedScenes = async (storyboard, taskId) => {
  const task = taskStore.getTaskById(taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const failedScenes = task.sceneResults.filter(s => s.status === 'failed');
  if (failedScenes.length === 0) {
    return { message: '没有失败的场景需要重试', sceneResults: task.sceneResults };
  }

  log('retry_failed_scenes_start', { taskId, failedCount: failedScenes.length });

  const useSiliconFlow = SILICONFLOW_API_KEY;
  const useKling = process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY;

  const updatedResults = [...task.sceneResults];

  for (const failed of failedScenes) {
    const index = failed.sceneIndex;
    const shot = storyboard[index];

    try {
      log('retry_scene', { index, shot: shot.shot });

      let result;
      if (useSiliconFlow) {
        result = await generateClipWithSiliconFlow({
          prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
          imageUrl: shot.imageUrl,
          durationSeconds: parseInt(shot.duration) || 5
        });
      } else if (useKling) {
        result = await generateClipWithKling({
          prompt: shot.prompt || shot.description || `Scene ${shot.shot}`,
          firstFrameUrl: shot.imageUrl,
          durationSeconds: parseInt(shot.duration) || 5
        });
      }

      updatedResults[index] = {
        ...updatedResults[index],
        status: 'success',
        videoPath: result.video_path,
        provider: result.provider,
        error: null
      };

      log('retry_scene_success', { index, shot: shot.shot });

    } catch (error) {
      log('retry_scene_failed', { index, shot: shot.shot, error: error.message });
      updatedResults[index] = {
        ...updatedResults[index],
        error: error.message
      };
    }
  }

  // 更新任务
  taskStore.updateTask(taskId, {
    sceneResults: updatedResults
  });

  const stillFailed = updatedResults.filter(s => s.status === 'failed');

  return {
    message: `重试完成：${failedScenes.length - stillFailed.length}个成功，${stillFailed.length}个仍失败`,
    sceneResults: updatedResults,
    failedCount: stillFailed.length
  };
};

// 重新合成视频（用于重试成功后）
exports.recomposeVideo = async (storyboard, taskId) => {
  const task = taskStore.getTaskById(taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const successScenes = task.sceneResults.filter(s => s.status === 'success');
  if (successScenes.length === 0) {
    throw new Error('没有成功的场景可以合成');
  }

  ensureDirs();

  taskStore.updateTask(taskId, {
    status: 'running',
    message: '正在处理音频...'
  });

  try {
    const videoFiles = successScenes.map(s => s.videoPath).filter(Boolean);

    const outputName = `full_story_${Date.now()}.mp4`;
    const outputPath = path.join(videoDir, outputName);

    // 处理音频：为每个音频添加居中静音填充
    const paddedAudioPaths = await processAudiosWithPadding(successScenes);
    const validPaddedAudioPaths = paddedAudioPaths.filter(p => p !== null);

    log('recompose_audio_padding', {
      originalAudioCount: successScenes.filter(s => s.audioPath).length,
      paddedAudioCount: validPaddedAudioPaths.length
    });

    const concatListPath = path.join(videoDir, `concat_list_${Date.now()}.txt`);
    const concatContent = videoFiles.map(f => `file '${f}'`).join('\n');
    await fs.promises.writeFile(concatListPath, concatContent);

    taskStore.updateTask(taskId, {
      progress: 90,
      message: '正在合成视频...'
    });

    if (validPaddedAudioPaths.length > 0) {
      const combinedAudioPath = path.join(audioDir, `combined_${Date.now()}.mp3`);

      await new Promise((resolve, reject) => {
        const command = ffmpeg();
        validPaddedAudioPaths.forEach((audioPath) => {
          command.input(audioPath);
        });
        command
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .mergeToFile(combinedAudioPath, audioDir);
      });

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .input(combinedAudioPath)
          .outputOptions([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v',
            '-map', '1:a'
          ])
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outputPath);
      });

    } else {
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outputPath);
      });
    }

    const finalVideoUrl = `http://localhost:${process.env.PORT || 3005}/videos/${outputName}`;

    taskStore.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      finalVideoUrl,
      message: '视频合成完成'
    });

    log('recompose_complete', { taskId, videoUrl: finalVideoUrl, scenes: successScenes.length });

    return { videoUrl: finalVideoUrl };

  } catch (error) {
    // 合成失败时更新任务状态
    taskStore.updateTask(taskId, {
      status: 'failed',
      errorMessage: error.message
    });
    throw error;
  }
};

// 拼接视频（单独调用）
exports.stitchVideos = async (videoUrls) => {
  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    throw new Error('videoUrls array is required');
  }

  ensureDirs();

  const outputName = `stitched_${Date.now()}.mp4`;
  const outputPath = path.join(videoDir, outputName);

  // 下载并保存所有视频
  const videoFiles = [];
  for (const url of videoUrls) {
    const fileName = `temp_${Date.now()}_${videoFiles.length}.mp4`;
    const filePath = path.join(videoDir, fileName);

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(filePath, buffer);

    videoFiles.push(filePath);
  }

  // 拼接
  const concatListPath = path.join(videoDir, `concat_list_${Date.now()}.txt`);
  const concatContent = videoFiles.map(f => `file '${f}'`).join('\n');
  await fs.promises.writeFile(concatListPath, concatContent);

  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });

  return `http://localhost:${process.env.PORT || 3005}/videos/${outputName}`;
};