const apiKey = "3a95fdaba1b747738a00e704fb20709c";
const targetId = "2075493439201959937";
const imageNodeId = "299";
const videoNodeId = "275";

async function test() {
  const wfUrl = 'https://www.runninghub.ai/task/openapi/ai-app/run';
  
  const payload = {
    apiKey,
    webappId: targetId,
    nodeInfoList: [
      { nodeId: imageNodeId, fieldName: 'image', fieldValue: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000' },
      { nodeId: videoNodeId, fieldName: 'video', fieldValue: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
    ],
  };

  console.log("Sending payload:", JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(wfUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'apikey': apiKey,
      },
      body: JSON.stringify(payload),
    });
    
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
