const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const res = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys[15]}` },
    body: JSON.stringify({
      apiKey: keys[15], webappId: "2075493439201959937",
      nodeInfoList: [
        { nodeId: '299', fieldName: 'image', fieldValue: 'https://rh-hk-images-switch.xiaoyaoyou.com/input/openapi/f71c8ba6dcdbbd92b51148e24580d086bbb9ab8a7f3347fc85b8babadabf30b8.jpg' },
        { nodeId: '275', fieldName: 'video', fieldValue: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
      ]
    })
  });
  console.log(await res.json());
}
test();
