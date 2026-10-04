const fetch = require('node-fetch');
async function test() {
  const apiKey = "3a95fdaba1b747738a00e704fb20709c"; // A test key
  const res = await fetch('http://localhost:3000/api/runninghub/motion-control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-runninghub-api-key': apiKey },
    body: JSON.stringify({
      imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      model: 'kling-v3.0'
    })
  });
  console.log(await res.text());
}
test();
