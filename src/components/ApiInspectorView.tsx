import React, { useState } from 'react';
import { Terminal, Copy, Check, Code2, BookOpen, Layers, ShieldAlert, Cpu } from 'lucide-react';
import { AppSettings } from '../types';

interface ApiInspectorViewProps {
  settings: AppSettings;
  hasServerKey: boolean;
}

export const ApiInspectorView: React.FC<ApiInspectorViewProps> = ({ settings }) => {
  const [copiedLang, setCopiedLang] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'python' | 'curl' | 'nodejs'>('python');

  const apiKeyToDisplay = settings.apiKey || 'YOUR_32_BIT_RUNNINGHUB_API_KEY';

  const pythonSnippet = `import os
import requests
import json
import time

def main():
    API_KEY = "${apiKeyToDisplay}"
    
    url = "https://www.runninghub.ai/openapi/v2/kling-v3.0-std/motion-control"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }
    payload = {
        "imageUrl": "https://example.com/character.jpg",
        "videoUrl": "https://example.com/driving_motion.mp4",
        "characterOrientation": "video",
        "prompt": None,
        "negativePrompt": None,
        "keepOriginalSound": True
    }

    response = requests.post(url, headers=headers, data=json.dumps(payload))
    if response.status_code == 200:
        result = response.json()
        task_id = result.get("taskId")
        print(f"Task submitted successfully. Task ID: {task_id}")
    else:
        print(f"Error: {response.status_code}, {response.text}")
        return

    query_url = "https://www.runninghub.ai/openapi/v2/query"
    query_headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }

    # Poll for results
    while True:
        query_payload = {"taskId": task_id}
        response = requests.post(query_url, headers=query_headers, data=json.dumps(query_payload))
        if response.status_code == 200:
            result = response.json()
            status = result["status"]

            if status == "SUCCESS":
                if result.get("results") and len(result["results"]) > 0:
                    output_url = result["results"][0]["url"]
                    print(f"Task completed. Video URL: {output_url}")
                break
            elif status in ["RUNNING", "QUEUED"]:
                print(f"Processing... Status: {status}")
            else:
                print(f"Task failed: {result.get('errorMessage')}")
                break
        time.sleep(5)

if __name__ == "__main__":
    main()`;

  const curlSnippet = `# Submit Motion Control Task
curl -X POST "https://www.runninghub.ai/openapi/v2/kling-v3.0-std/motion-control" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyToDisplay}" \\
  -d '{
    "imageUrl": "https://example.com/character.jpg",
    "videoUrl": "https://example.com/driving_motion.mp4",
    "characterOrientation": "video",
    "keepOriginalSound": true
  }'

# Query Task Status
curl -X POST "https://www.runninghub.ai/openapi/v2/query" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyToDisplay}" \\
  -d '{
    "taskId": "YOUR_TASK_ID_HERE"
  }'`;

  const nodejsSnippet = `import fetch from 'node-fetch';

const API_KEY = "${apiKeyToDisplay}";

async function generateMotionControl() {
  const submitRes = await fetch("https://www.runninghub.ai/openapi/v2/kling-v3.0-std/motion-control", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": \`Bearer \${API_KEY}\`
    },
    body: JSON.stringify({
      imageUrl: "https://example.com/character.jpg",
      videoUrl: "https://example.com/driving_motion.mp4",
      characterOrientation: "video",
      keepOriginalSound: true
    })
  });

  const { taskId } = await submitRes.json();
  console.log("Submitted task:", taskId);

  // Poll status
  const pollInterval = setInterval(async () => {
    const queryRes = await fetch("https://www.runninghub.ai/openapi/v2/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": \`Bearer \${API_KEY}\`
      },
      body: JSON.stringify({ taskId })
    });
    
    const data = await queryRes.json();
    if (data.status === "SUCCESS") {
      console.log("Generated video:", data.results[0].url);
      clearInterval(pollInterval);
    } else if (data.status === "FAILED") {
      console.error("Failed:", data.errorMessage);
      clearInterval(pollInterval);
    }
  }, 4000);
}

generateMotionControl();`;

  const copyToClipboard = (text: string, lang: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLang(lang);
    setTimeout(() => setCopiedLang(null), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded-xl">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">RunningHub Open API Documentation</h2>
            <p className="text-xs text-slate-400">
              Kling v3.0 Standard Motion Control endpoint schema & execution snippets
            </p>
          </div>
        </div>

        <span className="text-xs font-mono bg-slate-950 text-cyan-300 border border-slate-800 px-3 py-1.5 rounded-xl hidden sm:inline-block">
          Endpoint: /kling-v3.0-std/motion-control
        </span>
      </div>

      {/* Code Snippets Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('python')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'python'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Python 3
            </button>
            <button
              onClick={() => setActiveTab('curl')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'curl'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              cURL
            </button>
            <button
              onClick={() => setActiveTab('nodejs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'nodejs'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Node.js
            </button>
          </div>

          <button
            onClick={() => {
              const code =
                activeTab === 'python'
                  ? pythonSnippet
                  : activeTab === 'curl'
                  ? curlSnippet
                  : nodejsSnippet;
              copyToClipboard(code, activeTab);
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center space-x-1.5 border border-slate-700 transition-colors"
          >
            {copiedLang === activeTab ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-5 text-xs font-mono text-cyan-300 overflow-x-auto leading-relaxed bg-slate-950/80 max-h-96">
          {activeTab === 'python' && pythonSnippet}
          {activeTab === 'curl' && curlSnippet}
          {activeTab === 'nodejs' && nodejsSnippet}
        </pre>
      </div>

      {/* Schema Reference Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <span>Request Parameters Schema</span>
          </h3>

          <div className="space-y-2 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-mono">
                <span className="text-cyan-300 font-bold">imageUrl</span>
                <span className="text-amber-400 text-[10px]">Required | String</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Character reference image URL or base64. Width & height 300px–65536px; ratio 1:2.5 to 2.5:1. Max 10MB.
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-mono">
                <span className="text-cyan-300 font-bold">videoUrl</span>
                <span className="text-amber-400 text-[10px]">Required | String</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Driving video with motion to transfer (3–30s). Width & height 340px–3850px. Max 100MB.
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-mono">
                <span className="text-cyan-300 font-bold">characterOrientation</span>
                <span className="text-amber-400 text-[10px]">Required | "image" | "video"</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Orientation mode: "image" = follow image orientation (max 10s), "video" = follow video orientation (max 30s).
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between font-mono">
                <span className="text-cyan-300 font-bold">keepOriginalSound</span>
                <span className="text-slate-500 text-[10px]">Optional | Boolean</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Whether to retain the original audio track from the driving video in the generated output.
              </p>
            </div>
          </div>
        </div>

        {/* Error Codes & Status Codes */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Status Codes & Error Handling</span>
          </h3>

          <div className="space-y-2.5 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="font-mono font-bold text-emerald-400">SUCCESS</span>
              <p className="text-slate-400 text-[11px]">
                Generation completed. Output video URL is available in <code className="text-cyan-300">results[0].url</code>. Note: URL is valid for 24 hours.
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="font-mono font-bold text-amber-400">RUNNING / QUEUED</span>
              <p className="text-slate-400 text-[11px]">
                Task is queued or actively rendering on the ComfyUI cluster. Continue polling every 3–5 seconds.
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="font-mono font-bold text-rose-400">Code 1501: Content verification failed</span>
              <p className="text-slate-400 text-[11px]">
                The input image or video triggered safety filter. Modify prompt, use clearer face photo, or adjust driving video.
              </p>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <span className="font-mono font-bold text-rose-400">HTTP 401 Unauthorized</span>
              <p className="text-slate-400 text-[11px]">
                API Key is invalid or wallet has insufficient RH coins/balance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
