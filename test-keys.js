const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
const targetId = "2075493439201959937";
const imageNodeId = "299";
const videoNodeId = "275";

async function test() {
  for (const apiKey of keys.slice(0, 5)) {
    const wfUrl = 'https://www.runninghub.ai/task/openapi/ai-app/run';
    const payload = {
      apiKey, webappId: targetId,
      nodeInfoList: [
        { nodeId: imageNodeId, fieldName: 'image', fieldValue: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000' },
        { nodeId: videoNodeId, fieldName: 'video', fieldValue: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
      ],
    };
    try {
      const res = await fetch(wfUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'apikey': apiKey },
        body: JSON.stringify(payload),
      });
      console.log(`Key ${apiKey.slice(0, 6)}... -> ${await res.text()}`);
    } catch (e) {
      console.error(e);
    }
  }
}
test();
