const apiKey = "67f32f644ba6f04419d8518d114b0104"; // Use one of the good keys! Oh wait, I don't know which is which. 
// Let's use keys[9], f033cc...
const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
const goodKey = keys[8]; // wait, f033ccc9b845428f86480ef3c85c01f4 is index 8

const targetId = "2075493439201959937";
async function test() {
  const payload = {
    apiKey: goodKey, webappId: targetId,
    nodeInfoList: [
      { nodeId: '299', fieldName: 'image', fieldValue: 'https://files.catbox.moe/12345.jpg' },
      { nodeId: '275', fieldName: 'video', fieldValue: 'https://files.catbox.moe/67890.mp4' },
    ]
  };
  const res = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${goodKey}` },
    body: JSON.stringify(payload),
  });
  console.log(await res.text());
}
test();
