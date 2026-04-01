import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  generateStoryboardApi,
  generateVideoApi,
  listGalleryApi,
  saveGalleryApi,
  deleteGalleryApi,
  regenerateShotImageApi,
  startVideoGenerationApi,
  getTaskStatusApi,
  retryFailedScenesApi,
  recomposeVideoApi,
  createProjectApi,
  getActiveProjectApi,
  updateProjectApi,
} from './api';
import VideoLogs from './VideoLogs';
import {
  Container,
  Title,
  Text,
  Textarea,
  Button,
  Group,
  Stack,
  SimpleGrid,
  Card,
  Image,
  Badge,
  NumberInput,
  Slider,
  Alert,
  Skeleton,
  Modal,
  ScrollArea,
  ActionIcon,
  Progress,
  Switch,
  Chip,
  ThemeIcon,
  Box,
} from '@mantine/core';
import {
  IconRefresh,
  IconPlayerPlay,
  IconCheck,
  IconX,
  IconLoader,
  IconDownload,
} from '@tabler/icons-react';
import './App.css';

// 进度面板组件
function ProgressPanel({ taskId, projectId, onComplete, onFailed, testMode }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    if (!taskId || testMode) return;
    setLoading(true);
    try {
      const data = await getTaskStatusApi(taskId);
      setStatus(data);

      if (data.status === 'completed') {
        if (onComplete) onComplete(data);
        if (pollingRef.current) clearInterval(pollingRef.current);
      } else if (data.status === 'failed') {
        if (onFailed) onFailed(data);
        if (pollingRef.current) clearInterval(pollingRef.current);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId, testMode, onComplete, onFailed]);

  useEffect(() => {
    if (taskId && !testMode) {
      fetchStatus();
      // 每5秒自动查询
      pollingRef.current = setInterval(fetchStatus, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [taskId, testMode, fetchStatus]);

  if (testMode) {
    return (
      <Card withBorder padding="md" radius="md" mb="md">
        <Group justify="space-between">
          <Text>测试模式：视频已预生成</Text>
          <Badge color="green">完成</Badge>
        </Group>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card withBorder padding="md" radius="md" mb="md">
        <Group justify="space-between">
          <Text>等待开始...</Text>
          <Button size="xs" variant="light" onClick={fetchStatus} loading={loading}>
            查询进度
          </Button>
        </Group>
      </Card>
    );
  }

  const progressColor = status.status === 'failed' ? 'red' :
    status.status === 'completed' ? 'green' : 'blue';

  return (
    <Card withBorder padding="md" radius="md" mb="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500}>{status.message || '处理中...'}</Text>
          <Group gap="xs">
            <Badge color={progressColor}>
              {status.status === 'running' ? '进行中' :
                status.status === 'completed' ? '已完成' :
                  status.status === 'failed' ? '失败' : '等待中'}
            </Badge>
            <Button size="xs" variant="light" onClick={fetchStatus} loading={loading}>
              刷新进度
            </Button>
          </Group>
        </Group>

        <Progress
          value={status.progress || 0}
          color={progressColor}
          size="lg"
          radius="md"
        />

        <Group gap="md">
          <Text size="sm" c="dimmed">
            进度: {status.current || 0} / {status.total || 0}
          </Text>
          {status.completedScenes && status.completedScenes.length > 0 && (
            <Group gap={4}>
              <ThemeIcon color="green" size="sm">
                <IconCheck size={14} />
              </ThemeIcon>
              <Text size="sm" c="green">{status.completedScenes.length} 成功</Text>
            </Group>
          )}
          {status.failedScenes && status.failedScenes.length > 0 && (
            <Group gap={4}>
              <ThemeIcon color="red" size="sm">
                <IconX size={14} />
              </ThemeIcon>
              <Text size="sm" c="red">{status.failedScenes.length} 失败</Text>
            </Group>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

// 失败场景列表组件
function FailedScenesPanel({ failedScenes, onRetry, onRecompose, retrying }) {
  if (!failedScenes || failedScenes.length === 0) return null;

  return (
    <Card withBorder padding="md" radius="md" mb="md" style={{ borderColor: '#ff6b6b' }}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500} c="red">
            {failedScenes.length} 个场景生成失败
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              color="orange"
              onClick={onRetry}
              loading={retrying}
              leftSection={<IconRefresh size={14} />}
            >
              重试失败场景
            </Button>
          </Group>
        </Group>
        <Group gap="xs">
          {failedScenes.map(idx => (
            <Badge key={idx} color="red" variant="light">
              场景 {idx + 1}
            </Badge>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}

function App() {
  const [sentence, setSentence] = useState('');
  const [shotCount, setShotCount] = useState(6);
  const [storyboard, setStoryboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState([]);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [currentStoryId, setCurrentStoryId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [error, setError] = useState(null);
  const [savedStories, setSavedStories] = useState([]);
  const [viewStory, setViewStory] = useState(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [useAiShotCount, setUseAiShotCount] = useState(true); // 默认AI自动判断

  // 新增：任务和项目状态
  const [taskId, setTaskId] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [recoveringProject, setRecoveringProject] = useState(null);

  const STYLE_TEXT = '2D cartoon style, bright colors, cute characters, child-friendly, rounded shapes, simple background, suitable for children aged 6-10';

  // 恢复项目检查
  useEffect(() => {
    const checkActiveProject = async () => {
      try {
        const data = await getActiveProjectApi();
        if (data.project) {
          setRecoveringProject(data);
        }
      } catch (err) {
        console.log('No active project to recover');
      }
    };
    checkActiveProject();
  }, []);

  // 恢复项目
  const handleRecoverProject = (project) => {
    setSentence(project.topic || '');
    setStoryboard(project.storyboard);
    setShotCount(project.storyboard?.length || 6);
    setProjectId(project.id);
    if (project.taskId) setTaskId(project.taskId);
    setRecoveringProject(null);
    if (project.task) {
      setTaskStatus(project.task);
    }
  };

  // 放弃恢复
  const handleDismissRecover = () => {
    setRecoveringProject(null);
  };

  const resetHome = () => {
    setSentence('');
    setShotCount(6);
    setStoryboard(null);
    setVideos([]);
    setFullscreenVideo(null);
    setError(null);
    setViewStory(null);
    setCurrentStoryId(null);
    setPreviewImage(null);
    setTaskId(null);
    setProjectId(null);
    setTaskStatus(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchGallery = async () => {
      setGalleryLoading(true);
      try {
        const stories = await listGalleryApi();
        setSavedStories(stories);
      } catch (err) {
        console.error('Load gallery failed', err);
      } finally {
        setGalleryLoading(false);
      }
    };
    fetchGallery();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStoryboard(null);
    setVideos([]);
    setCurrentStoryId(null);
    setTaskId(null);
    setTaskStatus(null);

    try {
      // 如果使用AI自动判断，传递null；否则传递用户指定的数量
      const actualShotCount = useAiShotCount ? null : shotCount;
      const generatedStoryboard = await generateStoryboardApi(sentence, actualShotCount, STYLE_TEXT, testMode);
      setStoryboard(generatedStoryboard);

      // 如果是用户指定数量但AI返回了不同数量，更新显示
      if (!useAiShotCount && generatedStoryboard.length !== shotCount) {
        setShotCount(generatedStoryboard.length);
      }

      // 创建项目保存状态
      if (!testMode) {
        const projectData = await createProjectApi(sentence, generatedStoryboard, STYLE_TEXT);
        if (projectData.project) {
          setProjectId(projectData.project.id);
        }
      }
    } catch (err) {
      setError(err.message);
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 开始视频生成（带进度跟踪）
  const handleStartVideoGeneration = async () => {
    if (!storyboard) return;

    setError(null);
    setVideos([]);

    try {
      const result = await startVideoGenerationApi(storyboard, projectId, testMode);
      setTaskId(result.taskId);
      if (result.projectId) setProjectId(result.projectId);

      // 如果是测试模式，直接设置视频
      if (testMode && result.videoUrl) {
        setVideos([{ url: result.videoUrl, createdAt: new Date().toISOString() }]);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // 视频生成完成回调
  const handleVideoComplete = (status) => {
    setTaskStatus(status);
    if (status.finalVideoUrl) {
      setVideos([{ url: status.finalVideoUrl, createdAt: new Date().toISOString() }]);
    }
  };

  // 视频生成失败回调
  const handleVideoFailed = (status) => {
    setTaskStatus(status);
    setError(status.errorMessage || '视频生成失败');
  };

  // 重试失败场景
  const handleRetryFailed = async () => {
    if (!taskId || !storyboard) return;
    setRetrying(true);
    setError(null);

    try {
      const result = await retryFailedScenesApi(taskId, storyboard);
      setTaskStatus(prev => ({
        ...prev,
        sceneResults: result.sceneResults,
      }));

      // 如果重试成功了一些，提示可以重新合成
      if (result.failedCount === 0) {
        setError(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  };

  // 重新合成视频
  const handleRecompose = async () => {
    if (!taskId || !storyboard) return;
    setRetrying(true);
    setError(null);

    try {
      const result = await recomposeVideoApi(taskId, storyboard);
      if (result.videoUrl) {
        setVideos([{ url: result.videoUrl, createdAt: new Date().toISOString() }]);
        setTaskStatus(prev => ({
          ...prev,
          status: 'completed',
          finalVideoUrl: result.videoUrl,
        }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  };

  // 兼容旧版视频生成
  const handleGenerateVideo = async () => {
    if (!storyboard) return;
    setError(null);
    try {
      const url = await generateVideoApi(storyboard, testMode);
      const newVideo = { url, createdAt: new Date().toISOString() };
      setVideos([newVideo]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadImage = (imageUrl, filename) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename || 'shot.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isPlaceholderImage = (url) => {
    if (!url) return true;
    return url.includes('placehold.co');
  };

  const handleRegenerateShotImage = async (index) => {
    if (!storyboard || index < 0 || index >= storyboard.length) return;
    setRegeneratingIndex(index);
    setError(null);

    try {
      const shot = storyboard[index];
      let referenceImageBase64 = null;
      if (index > 0 && storyboard[0]?.imageUrl?.startsWith('data:')) {
        referenceImageBase64 = storyboard[0].imageUrl.split(',')[1];
      }
      const heroSubject = storyboard[0]?.heroSubject || '';
      const previousStyleHint = index > 0 ? storyboard[index - 1]?.prompt || '' : '';

      const newImageUrl = await regenerateShotImageApi(
        shot,
        STYLE_TEXT,
        referenceImageBase64,
        heroSubject,
        previousStyleHint
      );

      const updatedStoryboard = [...storyboard];
      updatedStoryboard[index] = { ...updatedStoryboard[index], imageUrl: newImageUrl };
      setStoryboard(updatedStoryboard);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const handleSaveStory = () => {
    if (!storyboard || !sentence) return;
    const story = {
      id: currentStoryId || undefined,
      title: sentence,
      createdAt: new Date().toISOString(),
      shotCount: storyboard.length,
      storyboard,
      style: STYLE_TEXT,
      videos,
    };
    saveGalleryApi(story)
      .then((saved) => {
        setSavedStories((prev) => [...prev.filter((s) => s.id !== saved.id), saved]);
        setCurrentStoryId(saved.id);
      })
      .catch((err) => setError(err.message));
  };

  const handleLoadStory = async (id) => {
    const story = savedStories.find((s) => s.id === id);
    if (!story) return;
    setSentence(story.title);
    setStoryboard(story.storyboard);
    setShotCount(story.shotCount || story.storyboard.length || 6);
    setVideos(story.videos || []);
    setCurrentStoryId(story.id);
    setViewStory(null);

    // 尝试查询项目状态，获取任务信息
    try {
      const projectData = await getProjectApi(id);
      if (projectData.project) {
        setProjectId(projectData.project.id);
        if (projectData.project.taskId) {
          setTaskId(projectData.project.taskId);
        }
        if (projectData.task) {
          setTaskStatus(projectData.task);
        }
      }
    } catch (err) {
      console.log('No project data for this story');
    }
  };

  const handleDeleteStory = (id) => {
    deleteGalleryApi(id)
      .then((stories) => setSavedStories(stories))
      .catch((err) => setError(err.message));
  };

  const handleViewStory = (story) => {
    setViewStory(story);
  };

  // 获取失败场景列表
  const getFailedScenes = () => {
    if (!taskStatus?.sceneResults) return [];
    return taskStatus.sceneResults
      .filter(s => s.status === 'failed')
      .map(s => s.sceneIndex);
  };

  const failedScenes = getFailedScenes();

  const renderShots = () => {
    if (loading) {
      return (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {Array.from({ length: shotCount || 6 }).map((_, idx) => (
            <Card key={idx} className="shot-card" padding="lg" radius="lg" shadow="lg" withBorder>
              <Skeleton height={18} width="60%" radius="sm" mb="sm" />
              <Skeleton height={16} width="30%" radius="sm" mb="md" />
              <Skeleton height={220} radius="md" mb="md" />
              <Skeleton height={14} radius="sm" mb={8} />
              <Skeleton height={14} radius="sm" width="80%" />
            </Card>
          ))}
        </SimpleGrid>
      );
    }

    if (!storyboard) return null;

    return (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {storyboard.map((shot, index) => {
          const isFailed = isPlaceholderImage(shot.imageUrl);
          const isRegenerating = regeneratingIndex === index;
          const sceneStatus = taskStatus?.sceneResults?.find(s => s.sceneIndex === index);
          const isSceneFailed = sceneStatus?.status === 'failed';
          const isSceneSuccess = sceneStatus?.status === 'success';

          return (
            <Card
              key={`shot-${index}`}
              className="shot-card"
              padding="lg"
              radius="lg"
              shadow="xl"
              withBorder
              style={isSceneFailed ? { borderColor: '#ff6b6b' } : {}}
            >
              <div
                className={`shot-image-wrapper ${isFailed ? 'shot-image-failed' : ''}`}
                onClick={isFailed && !isRegenerating ? () => handleRegenerateShotImage(index) : (!isFailed && !isRegenerating ? () => setPreviewImage({ url: shot.imageUrl, name: `shot_${index + 1}.png` }) : undefined)}
                style={{ cursor: isFailed || !isRegenerating ? 'pointer' : undefined }}
                title={isFailed ? '点击重新生成' : '点击放大'}
              >
                {isRegenerating ? (
                  <Skeleton height={220} radius="md" />
                ) : (
                  <Image
                    src={shot.imageUrl}
                    alt={`Shot ${shot.shot}`}
                    height={220}
                    radius="md"
                    withPlaceholder
                    className="shot-image"
                  />
                )}
                {isFailed && !isRegenerating && (
                  <div className="shot-retry-overlay">
                    <Text size="sm" c="white">点击重新生成</Text>
                  </div>
                )}
                {isSceneSuccess && (
                  <Badge
                    color="green"
                    style={{ position: 'absolute', top: 8, right: 8 }}
                  >
                    ✓
                  </Badge>
                )}
                {isSceneFailed && (
                  <Badge
                    color="red"
                    style={{ position: 'absolute', top: 8, right: 8 }}
                  >
                    ✗
                  </Badge>
                )}
              </div>
              <Title order={4} className="shot-title" mb="sm">
                {shot.description}
              </Title>
              <Text size="md" className="shot-prompt">
                {shot.shotStory || shot.prompt}
              </Text>
            </Card>
          );
        })}
        {videos.map((video, idx) => (
          <Card key={`video-${idx}`} className="shot-card video-shot-card" padding="lg" radius="lg" shadow="xl" withBorder>
            <div className="shot-image-wrapper video-wrapper">
              <video
                src={video.url}
                className="video-thumbnail"
                muted
                loop
                playsInline
                onMouseEnter={(e) => e.target.play()}
                onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
              />
              <div className="video-overlay">
                <ActionIcon
                  variant="filled"
                  color="cyan"
                  size="xl"
                  radius="xl"
                  onClick={() => setFullscreenVideo(video.url)}
                >
                  <IconPlayerPlay size={20} />
                </ActionIcon>
              </div>
            </div>
            <Title order={4} className="shot-title" mb="sm">
              生成视频 #{idx + 1}
            </Title>
          </Card>
        ))}
      </SimpleGrid>
    );
  };

  return (
    <div className="app-shell">
      <Container size="xl" py="md">
        <div className="hero">
          <Group justify="space-between" align="center">
            <Title order={1} className="hero-title" onClick={resetHome}>
              少儿科普动漫生成
            </Title>
            <Button
              className="log-button"
              size="md"
              variant="gradient"
              gradient={{ from: 'cyan', to: 'indigo' }}
              onClick={() => setShowLogs(true)}
            >
              Log
            </Button>
          </Group>
        </div>

        {/* 恢复项目提示 */}
        {recoveringProject && (
          <Alert color="blue" variant="light" mb="md" withCloseButton onClose={handleDismissRecover}>
            <Group justify="space-between" align="center">
              <Text>检测到未完成的项目：{recoveringProject.project?.topic || '未命名'}</Text>
              <Group gap="xs">
                <Button size="xs" color="blue" onClick={() => handleRecoverProject(recoveringProject.project)}>
                  恢复项目
                </Button>
                <Button size="xs" variant="light" onClick={handleDismissRecover}>
                  放弃
                </Button>
              </Group>
            </Group>
          </Alert>
        )}

        <Card className="glass-panel" withBorder padding="lg" radius="xl" shadow="xl">
          <form onSubmit={handleSubmit}>
            <Stack gap={8}>
              <Stack gap={4}>
                <Text c="dimmed" className="form-label">
                  故事描述
                </Text>
                <Textarea
                  value={sentence}
                  onChange={(e) => setSentence(e.target.value)}
                  placeholder="输入科普选题，例如：为什么天是蓝的？"
                  minRows={1}
                  maxRows={4}
                  required
                  autosize
                />
              </Stack>

              <Group align="center" justify="space-between" wrap="wrap" gap="md">
                <NumberInput
                  label="分镜数量"
                  description={useAiShotCount ? "AI将自动判断最佳数量" : `将生成 ${shotCount} 张分镜`}
                  min={2}
                  max={12}
                  value={shotCount}
                  onChange={(val) => {
                    setShotCount(Number(val) || 6);
                    setUseAiShotCount(false);
                  }}
                  maw={140}
                />
                <Button
                  size="md"
                  variant={useAiShotCount ? "filled" : "light"}
                  color="violet"
                  onClick={() => setUseAiShotCount(true)}
                >
                  {useAiShotCount ? '✓ AI自动判断' : 'AI自动判断'}
                </Button>
                <Switch
                  label="测试模式"
                  checked={testMode}
                  onChange={(e) => setTestMode(e.currentTarget.checked)}
                  color="orange"
                  description="使用已有数据"
                />
                <Button type="submit" size="md" variant="gradient" gradient={{ from: 'cyan', to: 'indigo' }} loading={loading}>
                  {loading ? '生成中...' : '生成脚本'}
                </Button>
              </Group>
            </Stack>
          </form>
        </Card>

        {error && (
          <Alert color="red" variant="light" mt="md">
            {error}
          </Alert>
        )}

        {(storyboard || loading) && (
          <div className="section">
            <Group justify="space-between" align="center" mb="md">
              <div>
                <Title order={2} className="section-title">
                  当前分镜
                </Title>
              </div>
              <Group gap="sm">
                <Button variant="subtle" color="gray" onClick={handleSaveStory} disabled={!storyboard}>
                  保存到画廊
                </Button>
                <Button
                  variant="outline"
                  color="teal"
                  onClick={handleStartVideoGeneration}
                  loading={loading}
                  disabled={!storyboard || (taskId && taskStatus?.status === 'running')}
                >
                  {taskId && taskStatus?.status === 'running' ? '生成中...' : '开始生成视频'}
                </Button>
              </Group>
            </Group>

            {/* 进度面板 */}
            {taskId && (
              <ProgressPanel
                taskId={taskId}
                projectId={projectId}
                testMode={testMode}
                onComplete={handleVideoComplete}
                onFailed={handleVideoFailed}
              />
            )}

            {/* 失败场景面板 */}
            {failedScenes.length > 0 && (
              <FailedScenesPanel
                failedScenes={failedScenes}
                onRetry={handleRetryFailed}
                onRecompose={handleRecompose}
                retrying={retrying}
              />
            )}

            {/* 当有失败场景成功重试后，显示重新合成按钮 */}
            {/* 条件：任务已完成 + 有成功的场景 + (没有视频 或 视频数量少于成功场景数) */}
            {taskStatus?.status === 'completed' &&
              taskStatus?.sceneResults?.filter(s => s.status === 'success').length > 0 &&
              (videos.length === 0 || videos.length < taskStatus?.sceneResults?.filter(s => s.status === 'success').length) && (
                <Card withBorder padding="md" radius="md" mb="md" style={{ borderColor: '#20c997' }}>
                  <Group justify="space-between">
                    <Text>
                      {videos.length === 0
                        ? '所有场景已成功，是否合成视频？'
                        : `有 ${taskStatus?.sceneResults?.filter(s => s.status === 'success').length - videos.length} 个新成功的场景，是否重新合成视频？`}
                    </Text>
                    <Button color="teal" onClick={handleRecompose} loading={retrying}>
                      重新合成视频
                    </Button>
                  </Group>
                </Card>
              )}

            {renderShots()}
          </div>
        )}

        {savedStories.length > 0 && (
          <div className="section gallery">
            <Group justify="space-between" align="center" mb="md">
              <div>
                <Title order={2} className="section-title">
                  画廊
                </Title>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
              {savedStories.map((story) => (
                <Card key={story.id} className="gallery-card" padding="lg" radius="lg" withBorder shadow="lg">
                  <Image
                    src={story.storyboard?.[0]?.imageUrl}
                    alt={story.title}
                    height={180}
                    radius="md"
                    withPlaceholder
                    className="gallery-image"
                  />
                  <Title order={4} className="gallery-title">
                    {story.title}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {new Date(story.createdAt).toLocaleString()} · {story.shotCount || story.storyboard.length} 张
                  </Text>
                  <div className="gallery-links">
                    <button className="link-btn" onClick={() => handleViewStory(story)}>查看</button>
                    <span className="link-sep">·</span>
                    <button className="link-btn" onClick={() => handleLoadStory(story.id)}>载入</button>
                    <span className="link-sep">·</span>
                    <button className="link-btn" onClick={() => handleDeleteStory(story.id)}>删除</button>
                  </div>
                </Card>
              ))}
            </SimpleGrid>
          </div>
        )}

        <Modal
          opened={!!viewStory}
          onClose={() => setViewStory(null)}
          title={viewStory?.title}
          size="xl"
          radius="lg"
          centered
        >
          {viewStory && (
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                {new Date(viewStory.createdAt).toLocaleString()} · {viewStory.shotCount || viewStory.storyboard.length} 张
              </Text>
              <ScrollArea h={520} type="always" scrollHideDelay={0}>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  {viewStory.storyboard.map((shot, idx) => (
                    <Card key={idx} withBorder radius="md" padding="md" className="viewer-card">
                      <Image
                        src={shot.imageUrl}
                        alt={`Shot ${shot.shot}`}
                        height={180}
                        radius="md"
                        withPlaceholder
                        mb="sm"
                      />
                      <Title order={5} className="shot-title">
                        {shot.description}
                      </Title>
                      <Text size="sm" className="shot-prompt">
                        {shot.shotStory || shot.prompt}
                      </Text>
                    </Card>
                  ))}
                </SimpleGrid>
              </ScrollArea>
            </Stack>
          )}
        </Modal>

      </Container>

      <Modal
        opened={showLogs}
        onClose={() => setShowLogs(false)}
        fullScreen
        radius={0}
        transitionProps={{ transition: 'fade', duration: 200 }}
      >
        <VideoLogs onBack={() => setShowLogs(false)} />
      </Modal>

      <Modal
        opened={!!fullscreenVideo}
        onClose={() => setFullscreenVideo(null)}
        size="xl"
        radius="lg"
        centered
        padding={0}
        withCloseButton
        classNames={{ body: 'video-modal-body' }}
      >
        {fullscreenVideo && (
          <video
            src={fullscreenVideo}
            controls
            autoPlay
            style={{ width: '100%', borderRadius: 8 }}
          />
        )}
      </Modal>

      <Modal
        opened={!!previewImage}
        onClose={() => setPreviewImage(null)}
        size="xl"
        radius="lg"
        centered
        padding="md"
        withCloseButton
        classNames={{ body: 'preview-image-modal' }}
      >
        {previewImage && (
          <div style={{ position: 'relative' }}>
            <ActionIcon
              variant="transparent"
              color="gray"
              size="lg"
              radius="md"
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
              onClick={() => handleDownloadImage(previewImage.url, previewImage.name)}
              title="下载图片"
            >
              <IconDownload size={16} />
            </ActionIcon>
            <Image
              src={previewImage.url}
              alt="Preview"
              radius="md"
              fit="cover"
              style={{ maxHeight: '80vh', width: '100%' }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default App;