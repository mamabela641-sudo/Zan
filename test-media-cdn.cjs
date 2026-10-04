const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  const url = "https://files.catbox.moe/67890.mp4";
  const res = await fetch(url);
  console.log("Catbox test:", res.status);
}
test();
