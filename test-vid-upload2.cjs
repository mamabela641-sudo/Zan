const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const apiKey = keys[8];
  const url = "https://www.runninghub.ai/openapi/v2/media/upload/binary";
  const formData = new FormData();
  
  const buffer = fs.readFileSync('package.json');
  formData.append('file', new Blob([buffer], {type: 'video/mp4'}), 'sample.mp4');
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'apikey': apiKey },
    body: formData
  });
  console.log("v2 upload dummy video:", await res.json());
}
test();
