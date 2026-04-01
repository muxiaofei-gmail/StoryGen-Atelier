const { log } = require('../utils/logger');
const { fetch } = require('undici');
const fs = require('fs');

const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1';
const SILICONFLOW_IMAGE_MODEL = process.env.SILICONFLOW_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';

// 强制风格前缀 - 确保2D扁平卡通风格
const STYLE_PREFIX = "Flat 2D cartoon style, hand-drawn animation look, cel shading, bright vibrant colors, simple clean lines, rounded cute shapes, child-friendly illustration";

// 负面提示词 - 禁止出现的风格
const NEGATIVE_PROMPT = "3D, realistic, photorealistic, rendered, depth, shading, volumetric lighting, detailed texture, CGI, blender, unreal engine";

/**
 * 下载图片并转换为 base64
 * @param {string} url - 图片URL
 * @returns {Promise<string>} - base64 编码的图片
 */
const downloadImageAsBase64 = async (url) => {
  if (url.startsWith('data:')) {
    // 已经是 base64 格式
    return url.split(',')[1];
  }

  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
};

/**
 * 清理和标准化 prompt，确保风格一致性
 * @param {string} prompt - 原始 prompt
 * @returns {string} - 标准化后的 prompt
 */
const normalizePrompt = (prompt) => {
  // 如果 prompt 已经包含风格前缀，直接返回
  if (prompt.toLowerCase().includes('flat 2d') || prompt.toLowerCase().includes('2d cartoon')) {
    // 确保 NO 3D 等负面提示存在
    if (!prompt.toLowerCase().includes('no 3d')) {
      return `${prompt}, NO 3D, NO realistic, NO rendering`;
    }
    return prompt;
  }

  // 否则添加完整的风格前缀
  return `${STYLE_PREFIX}, NO 3D, NO realistic, NO rendering. ${prompt}`;
};

// 硅基流动图片生成（强化风格一致性）
exports.generateImage = async (prompt, previousStyleHint = "", styleOverride, referenceImageBase64 = null, heroSubject = "") => {
  const apiKey = process.env.SILICONFLOW_API_KEY;

  // 检查API密钥
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('your_')) {
    console.log("No valid SILICONFLOW_API_KEY found. Using placeholder image.");
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30) + "...");
    return `https://placehold.co/600x400/4A90D9/FFF?text=${encodedPrompt}`;
  }

  // 构建完整提示词 - 强制添加风格前缀
  const normalizedPrompt = normalizePrompt(prompt);

  // 添加主角描述
  const fullPrompt = heroSubject
    ? `${normalizedPrompt}. Main characters: ${heroSubject}`
    : normalizedPrompt;

  log('image_gen_start', {
    promptPreview: fullPrompt.substring(0, 100),
    model: SILICONFLOW_IMAGE_MODEL
  });

  try {
    // 构建 API 请求参数
    const requestBody = {
      model: SILICONFLOW_IMAGE_MODEL,
      prompt: fullPrompt,
      image_size: "1024x576",  // 16:9比例
      num_inference_steps: 20   // FLUX快速推理步数
    };

    // 硅基流动 API 调用（OpenAI兼容格式）
    const response = await fetch(`${SILICONFLOW_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SiliconFlow API error: ${response.status} ${text}`);
    }

    const data = await response.json();

    // 返回图片URL
    if (data.images && data.images[0]) {
      if (data.images[0].url) {
        log('image_gen_success', { source: 'url' });
        return data.images[0].url;
      }
      if (data.images[0].b64_json) {
        log('image_gen_success', { source: 'base64' });
        return `data:image/png;base64,${data.images[0].b64_json}`;
      }
    }

    // 兼容其他响应格式
    if (data.data && data.data[0]) {
      if (data.data[0].url) {
        log('image_gen_success', { source: 'url' });
        return data.data[0].url;
      }
      if (data.data[0].b64_json) {
        log('image_gen_success', { source: 'base64' });
        return `data:image/png;base64,${data.data[0].b64_json}`;
      }
    }

    throw new Error('No image data in response');

  } catch (error) {
    console.error("Error generating image with SiliconFlow:", error.message);
    log('image_gen_error', { message: error.message });

    // Fallback Placeholder
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30) + "...");
    return `https://placehold.co/600x400/4A90D9/FFF?text=${encodedPrompt}`;
  }
};

// 导出辅助函数供其他模块使用
exports.downloadImageAsBase64 = downloadImageAsBase64;
exports.STYLE_PREFIX = STYLE_PREFIX;