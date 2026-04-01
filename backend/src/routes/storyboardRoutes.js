const express = require('express');
const {
  generateStoryboard,
  generateVideoFromStoryboard,
  planChunks,
  generateVideosForSegments,
  stitchVideos,
  regenerateShotImage,
  startVideoGeneration,
  retryFailedScenes,
  recomposeVideo,
} = require('../controllers/storyboardController');

const router = express.Router();

router.post('/generate', generateStoryboard);
router.post('/generate-video', generateVideoFromStoryboard);
router.post('/start-video-generation', startVideoGeneration);
router.post('/retry-failed-scenes', retryFailedScenes);
router.post('/recompose-video', recomposeVideo);
router.post('/regenerate-shot', regenerateShotImage);
router.post('/chunk-plan', planChunks);
router.post('/generate-videos', generateVideosForSegments);
router.post('/stitch', stitchVideos);

module.exports = router;
