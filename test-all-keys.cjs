const fs = require('fs');
const keys = JSON.parse(fs.readFileSync('keys_pool.json', 'utf-8'));
async function test() {
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch('https://www.runninghub.ai/uc/openapi/accountStatus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys[i]}` },
      body: JSON.stringify({ apiKey: keys[i] })
    });
    const data = await res.json();
    console.log(`Key ${i}: Coins = ${data.data?.remainCoins}`);
  }
}
test();
