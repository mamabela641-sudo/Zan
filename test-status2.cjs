const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const k = keys[8];
  const taskId = "2092606333352697857";
  const res = await fetch('https://www.runninghub.ai/openapi/v2/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` },
    body: JSON.stringify({ apiKey: k, taskId })
  });
  console.log(await res.text());
}
test();
