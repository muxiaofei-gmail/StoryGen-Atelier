const { log } = require('../utils/logger');
const { fetch } = require('undici');

// ========== 固定设定（不可更改） ==========

// 视频风格（中文，用于脚本生成）
const VIDEO_STYLE = "2D卡通风格，色彩明亮饱满，线条圆润，适合6-10岁儿童";

// 图片风格前缀（英文，强制添加到每个图片 prompt 开头）
// 强调扁平2D风格，禁止3D/真实感
const IMAGE_STYLE_PREFIX = "Flat 2D cartoon style, hand-drawn animation look, cel shading, bright vibrant colors, simple clean lines, rounded cute shapes, child-friendly illustration, NO 3D, NO realistic, NO rendering, NO depth shading";

// 视频类型
const VIDEO_TYPE = "少儿科普类视频";

// 主角设定
const CHARACTERS = {
  xiaoyou: {
    name: "小悠",
    description: "一个7岁的小女孩，扎着双马尾，大眼睛，穿着粉色连衣裙，活泼可爱，充满好奇心",
    englishDesc: "a cute 7-year-old girl named Xiaoyou with twin ponytails, big sparkly eyes, wearing pink dress, flat 2D cartoon character, simple design"
  },
  uncle: {
    name: "博士叔叔",
    description: "一位年轻的科学家，戴着眼镜，穿着白色实验服，亲切友善，喜欢给小朋友讲解科学知识",
    englishDesc: "a friendly young scientist uncle wearing glasses and white lab coat, flat 2D cartoon character, simple design"
  }
};

// 场景设定
const SCENE_SETTING = "博士叔叔的实验室，里面有各种有趣的实验器材、试管、显微镜、发光的仪器、书籍、黑板";

// 台词字数限制
const DIALOGUE_MAX_LENGTH = 16;

// 最大分镜数量限制
const MAX_SHOT_COUNT = 15;

// 导出风格前缀供图片生成使用
exports.IMAGE_STYLE_PREFIX = IMAGE_STYLE_PREFIX;

// ========== 生成少儿科普分镜脚本 ==========

const resizeStoryboard = (storyboard, desiredCount) => {
  if (!desiredCount || desiredCount <= 0) return storyboard;
  const result = [];
  for (let i = 0; i < desiredCount; i++) {
    const template = storyboard[i % storyboard.length];
    result.push({ ...template, shot: i + 1 });
  }
  return result;
};

// 通义千问API调用
const callTongyiAPI = async (prompt) => {
  const apiKey = process.env.TONGYI_API_KEY;
  const model = process.env.TONGYI_MODEL || 'qwen-plus';

  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('your_')) {
    throw new Error('TONGYI_API_KEY not configured');
  }

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      input: {
        messages: [
          { role: 'user', content: prompt }
        ]
      },
      parameters: {
        result_format: 'message'
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tongyi API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.output?.choices?.[0]?.message?.content || '';
};

// Fallback storyboard
const FALLBACK_STORYBOARD = [
  {
    shot: 1,
    prompt: `${IMAGE_STYLE_PREFIX}. A science lab with various experimental equipment. ${CHARACTERS.xiaoyou.englishDesc} walks in with a curious expression. ${CHARACTERS.uncle.englishDesc} waves hello. 16:9 aspect ratio.`,
    duration: "5",
    description: "小悠走进实验室",
    heroSubject: `${CHARACTERS.xiaoyou.englishDesc}; ${CHARACTERS.uncle.englishDesc}`,
    dialogue: {
      xiaoyou: "博士叔叔，我有个问题！",
      uncle: null
    }
  },
  {
    shot: 2,
    prompt: `${IMAGE_STYLE_PREFIX}. Close-up of ${CHARACTERS.xiaoyou.englishDesc} asking question with excited gesture in a science lab. ${CHARACTERS.uncle.englishDesc} listening carefully. 16:9 aspect ratio.`,
    duration: "5",
    description: "小悠提问",
    dialogue: {
      xiaoyou: null,
      uncle: "好问题！来看看阳光的秘密"
    }
  },
  {
    shot: 3,
    prompt: `${IMAGE_STYLE_PREFIX}. ${CHARACTERS.uncle.englishDesc} shows a prism to ${CHARACTERS.xiaoyou.englishDesc} in a science lab, light splitting into rainbow colors. 16:9 aspect ratio.`,
    duration: "5",
    description: "博士叔叔展示三棱镜",
    dialogue: {
      xiaoyou: "哇，七彩的颜色！",
      uncle: null
    }
  },
  {
    shot: 4,
    prompt: `${IMAGE_STYLE_PREFIX}. ${CHARACTERS.xiaoyou.englishDesc} and ${CHARACTERS.uncle.englishDesc} look at blue sky through window together. 16:9 aspect ratio.`,
    duration: "5",
    description: "一起看蓝天",
    dialogue: {
      xiaoyou: null,
      uncle: "蓝光乱跑，天空就蓝啦！"
    }
  }
];

// 生成少儿科普分镜脚本
exports.generatePrompts = async (sentence, shotCount = null, styleOverride) => {
  const apiKey = process.env.TONGYI_API_KEY;

  // 检查API密钥
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('your_')) {
    log('storyboard_llm_fallback_no_key', { requestedShots: shotCount });
    return resizeStoryboard(FALLBACK_STORYBOARD, shotCount || 6);
  }

  // 如果没有指定 shotCount，则让 AI 自动判断
  const autoMode = shotCount === null || shotCount === undefined;

  log('storyboard_llm_start', {
    model: process.env.TONGYI_MODEL || 'qwen-plus',
    requestedShots: autoMode ? 'auto (max ' + MAX_SHOT_COUNT + ')' : shotCount
  });

  // 完整的提示词模板
  const systemPrompt = `你是一位专业的少儿科普视频脚本创作者。

## 固定设定（必须遵守）

### 视频风格
${VIDEO_STYLE}

### 视频类型
${VIDEO_TYPE}

### 主角角色
1. **小悠**：${CHARACTERS.xiaoyou.description}
2. **博士叔叔**：${CHARACTERS.uncle.description}

### 场景
所有场景都发生在：${SCENE_SETTING}

## 创作要求

1. **语言风格**：
   - 小悠的台词要活泼可爱，充满好奇心
   - 博士叔叔的台词要亲切耐心，用简单有趣的比喻解释科学知识
   - 避免专业术语，用孩子能听懂的方式表达

2. **场景设计**：
   - 每个场景都要在博士叔叔的实验室中
   - 可以使用实验室里的道具进行演示
   - 画面要生动有趣，符合2D卡通风格
   - **人物出场灵活安排**：
     - 整个视频中，小悠和博士叔叔都要有出场
     - 单个分镜可以根据剧情需要灵活安排人物
     - 可以是双人画面、单人特写、道具特写等
     - 例如：小悠提问的特写、博士叔叔演示的特写、实验道具的特写等

3. **图片Prompt格式要求（非常重要）**：
   - **每个prompt必须以风格前缀开头**："Flat 2D cartoon style, hand-drawn animation, cel shading, bright colors, simple lines, NO 3D, NO realistic"
   - prompt必须是英文
   - 禁止使用：3D, realistic, rendered, detailed shading, depth, volumetric lighting
   - 强调：flat, 2D, cartoon, simple, cute, hand-drawn
   - 示例prompt: "Flat 2D cartoon style, hand-drawn animation, cel shading, bright colors, simple lines, NO 3D, NO realistic. A cute 7-year-old girl in pink dress standing in a lab, 16:9 aspect ratio"

3. **对话要求**：
   - **每个分镜只有一个角色说话**（小悠或博士叔叔二选一）
   - 台词要简洁，**不超过${DIALOGUE_MAX_LENGTH}个字**
   - 对话要自然流畅，有问有答
   - 小悠通常是提问者，博士叔叔是解答者
   - 该分镜无对话的角色，dialogue中设为null
   - **不需要旁白**，只保留角色对话

4. **时长**：每个场景约5秒

5. **分镜数量**：
   - 根据选题内容自动决定需要的场景数量
   - 最少3个场景，最多${MAX_SHOT_COUNT}个场景
   - 简单话题3-5个场景，复杂话题可增加至10-15个场景
   - 确保故事完整、逻辑清晰

## 输出格式

只返回JSON数组，不要markdown标记。**第一个场景必须包含 heroSubject 字段**：

第一个场景格式：
{
  "shot": 1,
  "prompt": "Flat 2D cartoon style, hand-drawn animation, cel shading, bright colors, simple lines, NO 3D, NO realistic. [具体画面描述的英文]",
  "duration": "5",
  "description": "中文一句话描述画面内容",
  "heroSubject": "Detailed English description of main characters for consistency, including: appearance, clothing colors, body type, distinctive features. Example: 'a cute 7-year-old girl named Xiaoyou with twin ponytails, big eyes, wearing pink dress; a friendly young scientist uncle wearing glasses and white lab coat'",
  "dialogue": {
    "xiaoyou": "小悠的台词（不超过16字）或null",
    "uncle": "博士叔叔的台词（不超过16字）或null"
  }
}

后续场景格式（不需要 heroSubject）：
{
  "shot": 序号,
  "prompt": "Flat 2D cartoon style, hand-drawn animation, cel shading, bright colors, simple lines, NO 3D, NO realistic. [具体画面描述的英文]",
  "duration": "5",
  "description": "中文画面摘要",
  "dialogue": {
    "xiaoyou": "小悠的台词（不超过16字）或null",
    "uncle": "博士叔叔的台词（不超过16字）或null"
  }
}

**重要规则**：
- 每个分镜的dialogue中，只有一个角色有台词，另一个必须为null
- 台词不超过${DIALOGUE_MAX_LENGTH}个字
- 不需要旁白，只保留角色对话
- 特写镜头可以只出现一个人物或不出现人物
- 确保JSON格式正确，不要有多余文字`;

  const userPrompt = autoMode
    ? `请为以下选题创作分镜脚本，场景数量根据内容需要自动决定（最少3个，最多${MAX_SHOT_COUNT}个）：

**选题**：${sentence}

要求：
1. 小悠和博士叔叔在整个视频中都要有出场，但单个分镜可根据剧情灵活安排人物
2. 场景在实验室中
3. **每个分镜只有一个角色说话，台词不超过${DIALOGUE_MAX_LENGTH}字**
4. **不需要旁白，只保留角色对话**
5. 内容要适合6-10岁儿童理解
6. 根据选题复杂度决定场景数量，确保故事完整`
    : `请为以下选题创作 ${shotCount} 个场景的分镜脚本：

**选题**：${sentence}

要求：
1. 小悠和博士叔叔在整个视频中都要有出场，但单个分镜可根据剧情灵活安排人物
2. 场景在实验室中
3. **每个分镜只有一个角色说话，台词不超过${DIALOGUE_MAX_LENGTH}字**
4. **不需要旁白，只保留角色对话**
5. 内容要适合6-10岁儿童理解`;

  try {
    const fullPrompt = systemPrompt + '\n\n' + userPrompt;
    const text = await callTongyiAPI(fullPrompt);

    // 清理可能的markdown格式
    let cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();

    // 尝试找到JSON数组
    const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanedText = jsonMatch[0];
    }

    const storyboard = JSON.parse(cleanedText);

    // 验证格式
    if (!Array.isArray(storyboard) || storyboard.length === 0) {
      throw new Error('Invalid storyboard format');
    }

    // 限制最大分镜数量
    if (storyboard.length > MAX_SHOT_COUNT) {
      log('storyboard_trimmed', { original: storyboard.length, trimmed: MAX_SHOT_COUNT });
      storyboard = storyboard.slice(0, MAX_SHOT_COUNT);
    }

    // 确保每个元素有必要的字段，并强制添加风格前缀
    storyboard.forEach((shot, i) => {
      shot.shot = i + 1;
      shot.duration = shot.duration || "5";

      // 确保 prompt 包含风格前缀
      if (!shot.prompt) {
        shot.prompt = `${IMAGE_STYLE_PREFIX}. A scene in a science lab, 16:9 aspect ratio`;
      } else {
        // 检查是否已包含风格前缀，如果没有则添加
        const hasStylePrefix = shot.prompt.toLowerCase().includes('flat 2d') ||
                                shot.prompt.toLowerCase().includes('2d cartoon') ||
                                shot.prompt.toLowerCase().includes('cartoon style');
        if (!hasStylePrefix) {
          shot.prompt = `${IMAGE_STYLE_PREFIX}. ${shot.prompt}`;
        }
      }

      if (!shot.description) shot.description = `场景${i + 1}`;
      if (!shot.dialogue) {
        shot.dialogue = { xiaoyou: null, uncle: null };
      }
      // 确保dialogue格式正确
      if (!shot.dialogue.xiaoyou) shot.dialogue.xiaoyou = null;
      if (!shot.dialogue.uncle) shot.dialogue.uncle = null;
      if (!shot.shotStory) shot.shotStory = `这是第${i + 1}个场景。`;
    });

    log('storyboard_llm_success', { shots: storyboard.length });
    // 自动模式下不强制调整数量，手动模式下按指定数量调整
    return autoMode ? storyboard : resizeStoryboard(storyboard, shotCount);

  } catch (error) {
    console.error("Error calling Tongyi API:", error);
    log('storyboard_llm_error', { message: error.message });

    // 如果有API密钥但失败，抛出错误让前端显示
    if (apiKey && !apiKey.startsWith('your_')) {
      throw error;
    }

    // 无密钥时使用fallback
    log('storyboard_llm_fallback_error', { reason: 'api_error', requestedShots: autoMode ? 'auto' : shotCount });
    return resizeStoryboard(FALLBACK_STORYBOARD, shotCount || 6);
  }
};

// 分析镜头转场
exports.analyzeShotTransition = async (shotA, shotB) => {
  return {
    transition_prompt: `Smooth cinematic transition from scene ${shotA.shot} to scene ${shotB.shot}`,
    duration: 5
  };
};

// 导出固定设定供其他模块使用
exports.CHARACTERS = CHARACTERS;
exports.SCENE_SETTING = SCENE_SETTING;
exports.VIDEO_STYLE = VIDEO_STYLE;
exports.DIALOGUE_MAX_LENGTH = DIALOGUE_MAX_LENGTH;
exports.MAX_SHOT_COUNT = MAX_SHOT_COUNT;