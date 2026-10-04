const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const apiKey = keys[8];
  const url = "https://www.runninghub.ai/openapi/v2/media/upload/binary";
  const formData = new FormData();
  const buffer = fs.readFileSync('package.json'); // just dummy data
  formData.append('file', new Blob([buffer]), 'package.json');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'apikey': apiKey },
    body: formData
  });
  console.log("v2 upload:", await res.json());

  const url2 = "https://www.runninghub.ai/task/openapi/upload";
  const formData2 = new FormData();
  formData2.append('file', new Blob([buffer]), 'package.json');
  formData2.append('apiKey', apiKey);
  const res2 = await fetch(url2, {
    method: 'POST',
    body: formData2
  });
  console.log("task/openapi upload:", await res2.json());
}
test();
