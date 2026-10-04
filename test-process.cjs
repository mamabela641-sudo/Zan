const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
const targetId = "2075493439201959937";
const imageNodeId = "299";
const videoNodeId = "275";

async function executeTaskSubmission(apiKey) {
  const rhImageUrl = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000";
  const rhVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
  const appUrl = 'https://www.runninghub.ai/task/openapi/ai-app/run';
  const res = await fetch(appUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'apikey': apiKey },
    body: JSON.stringify({
      apiKey, webappId: targetId,
      nodeInfoList: [
        { nodeId: imageNodeId, fieldName: 'image', fieldValue: rhImageUrl },
        { nodeId: videoNodeId, fieldName: 'video', fieldValue: rhVideoUrl },
      ]
    }),
  });
  const data = await res.json();
  console.log("Submitted:", data.data?.taskId);
  return data.data?.taskId;
}

async function checkStatus(apiKey, taskId) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch('https://www.runninghub.ai/openapi/v2/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ apiKey, taskId })
    });
    const data = await res.json();
    console.log(`Status [${i*5}s]:`, data.data?.status, data.data?.errorMessage || "");
    if (data.data?.status === "SUCCESS" || data.data?.status === "FAILED") return;
  }
}

async function test() {
  const key = keys[8];
  const taskId = await executeTaskSubmission(key);
  if (taskId) await checkStatus(key, taskId);
}
test();
