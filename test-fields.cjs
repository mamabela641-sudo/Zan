const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
const goodKey = keys[8]; // f033ccc9b845428f86480ef3c85c01f4
const targetId = "2075493439201959937";

async function test() {
  const payload = {
    apiKey: goodKey,
    webappId: targetId,
    nodeInfoList: [
      { nodeId: '299', fieldName: 'image', fieldValue: 'https://files.catbox.moe/12345.jpg' },
      { nodeId: '275', fieldName: 'video', fieldValue: 'https://files.catbox.moe/67890.mp4' },
    ],
    prompt: "A beautiful prompt",
    negativePrompt: "A negative prompt",
    resolution: '1080p',
    resolution_mode: '1080p',
    quality: 'high',
    quality_mode: 'pro',
    mode: 'pro',
    upscale: true,
    hd: true,
    high_definition: true,
    video_bitrate: 'high',
    bitrate: 'high',
    fps: 60,
    pose_type: 'sdpose',
    pose_model: 'sdpose',
    pose_calculation: 'sdpose',
    face_restore: true,
    face_enhancement: true,
    face_restore_weight: 1.0,
    expression_fidelity: 1.0,
    cfg_scale: 8.0,
  };
  
  const res = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${goodKey}` },
    body: JSON.stringify(payload),
  });
  console.log(await res.text());
}
test();
