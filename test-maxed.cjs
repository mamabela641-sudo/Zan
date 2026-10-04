const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  for (let i = 5; i < 15; i++) {
    const res = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys[i]}` },
      body: JSON.stringify({
        apiKey: keys[i], webappId: "2075493439201959937",
        nodeInfoList: [
          { nodeId: '299', fieldName: 'image', fieldValue: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000' },
          { nodeId: '275', fieldName: 'video', fieldValue: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
        ]
      })
    });
    const data = await res.json();
    console.log(`Key ${i}: ${data.msg}`);
  }
}
test();
