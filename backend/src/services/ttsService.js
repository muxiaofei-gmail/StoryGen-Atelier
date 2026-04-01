/**
 * TTS 服务 - 使用 Edge TTS (免费，无需API Key)
 * 支持多种中文儿童音色
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('../utils/logger');

const dataDir = path.join(__dirname, '../../data');
const audioDir = path.join(dataDir, 'audio');

// Python 脚本路径
const PYTHON_SCRIPT = path.join(__dirname, '../../..', 'tts_helper.py');

// 确保目录存在
const ensureDirs = () => {
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
};

// 可用的中文音色（Edge TTS 免费版）
const VOICES = {
  // 小悠 - 小女孩（活泼可爱）
  xiaoyou: 'zh-CN-XiaoyiNeural',

  // 博士叔叔 - 年轻博士（青年男声）
  uncle: 'zh-CN-YunjianNeural',

  // 晓晓 - 儿童女声（备用）
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',

  // 默认旁白
  narrator: 'zh-CN-XiaoxiaoNeural'
};

/**
 * 生成单个音频文件（使用Python脚本）
 * @param {string} text - 要转换的文本
 * @param {string} voiceName - 音色名称
 * @param {string} outputPath - 输出文件路径（使用正斜杠）
 * @returns {Promise<string>} - 生成的音频文件路径
 */
const generateSingleAudio = async (text, voiceName, outputPath) => {
  ensureDirs();

  // 使用正斜杠路径避免Windows转义问题
  const safePath = outputPath.replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    // 使用edge-tts命令行工具
    const { spawn } = require('child_process');

    // 转义文本中的特殊字符
    const escapedText = text.replace(/"/g, '\\"');

    // 使用edge-tts CLI
    const args = [
      '--text', escapedText,
      '--voice', voiceName,
      '--write-media', safePath
    ];

    log('tts_spawn', { args: args.join(' ') });

    const proc = spawn('edge-tts', args, { shell: true });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        log('tts_error', { code, stderr, text: text.substring(0, 50) });
        reject(new Error(`edge-tts failed: ${stderr}`));
        return;
      }

      if (fs.existsSync(outputPath)) {
        log('tts_success', { path: outputPath, size: fs.statSync(outputPath).size });
        resolve(outputPath);
      } else {
        reject(new Error('Audio file not created'));
      }
    });

    proc.on('error', (err) => {
      log('tts_spawn_error', { error: err.message });
      reject(err);
    });
  });
};

/**
 * 为场景生成配音
 * @param {Object} scene - 场景对象，包含 narration, character, dialogue 等
 * @param {number} sceneIndex - 场景索引
 * @returns {Promise<string>} - 音频文件路径
 */
exports.generateSceneAudio = async (scene, sceneIndex) => {
  ensureDirs();

  // 获取配音文本 - 支持多种格式
  let text = null;
  let voice = VOICES.narrator;

  // 格式1: dialogue 是对象 { xiaoyou: "文本", uncle: null }
  if (scene.dialogue && typeof scene.dialogue === 'object') {
    if (scene.dialogue.xiaoyou) {
      text = scene.dialogue.xiaoyou;
      voice = VOICES.xiaoyou;
    } else if (scene.dialogue.uncle) {
      text = scene.dialogue.uncle;
      voice = VOICES.uncle;
    }
  }
  // 格式2: dialogue 是字符串
  else if (scene.dialogue && typeof scene.dialogue === 'string') {
    text = scene.dialogue;
    // 根据角色选择音色
    if (scene.character) {
      const charLower = scene.character.toLowerCase();
      if (charLower.includes('小悠') || charLower.includes('xiaoyou')) {
        voice = VOICES.xiaoyou;
      } else if (charLower.includes('叔叔') || charLower.includes('uncle') || charLower.includes('博士')) {
        voice = VOICES.uncle;
      }
    }
  }
  // 格式3: narration 字段
  else if (scene.narration) {
    text = scene.narration;
  }

  // 如果没有配音内容，返回 null
  if (!text || (typeof text === 'string' && text.trim() === '')) {
    log('tts_no_text', { sceneIndex });
    return null;
  }

  const outputPath = path.join(audioDir, `scene${sceneIndex}_${voice.split('-')[2]}.mp3`);

  log('tts_generate_start', { sceneIndex, voice, text: text.substring(0, 50) });

  try {
    await generateSingleAudio(text, voice, outputPath);
    return outputPath;
  } catch (error) {
    log('tts_generate_error', { sceneIndex, error: error.message });
    return null;
  }
};

/**
 * 批量生成所有场景的配音
 * @param {Array} storyboard - 分镜数组
 * @returns {Promise<Array>} - 音频文件路径数组
 */
exports.generateAllAudio = async (storyboard) => {
  ensureDirs();

  log('tts_batch_start', { count: storyboard.length });

  const audioPaths = [];

  for (let i = 0; i < storyboard.length; i++) {
    const scene = storyboard[i];
    const audioPath = await exports.generateSceneAudio(scene, i + 1);
    audioPaths.push(audioPath);

    // 稍作延迟，避免并发问题
    if (i < storyboard.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const successCount = audioPaths.filter(p => p !== null).length;
  log('tts_batch_complete', { total: storyboard.length, success: successCount });

  return audioPaths;
};

/**
 * 获取可用音色列表
 */
exports.getAvailableVoices = () => {
  return Object.entries(VOICES).map(([name, voiceId]) => ({
    name,
    voiceId,
    description: getVoiceDescription(name)
  }));
};

function getVoiceDescription(name) {
  const descriptions = {
    xiaoyou: '小女孩，活泼可爱，适合小悠角色',
    uncle: '年轻博士，亲切专业，适合博士叔叔',
    xiaoxiao: '儿童女声，活泼可爱',
    narrator: '默认旁白音色'
  };
  return descriptions[name] || '未知音色';
}

// 导出音色常量
exports.VOICES = VOICES;