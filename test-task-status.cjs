const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const taskId = "2092607811417038849";
  // We need to find the key that was used. Let's just try keys until one gives us the task info.
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch('https://www.runninghub.ai/task/openapi/ai-app/run/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys[i]}`, 'apikey': keys[i] },
      body: JSON.stringify({ apiKey: keys[i], taskId })
    });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      console.log(JSON.stringify(data.data, null, 2));
      return;
    }
  }
}
test();
