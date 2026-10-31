// A stand-in for api.vachana.ai that follows Gnani's documented protocols.
// Used by test/integration.test.js to check our client code without spending credits.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { pcmToWav } from '../server/audio/wav.js';

const KEY = 'test-key';
const tone = (ms, sr = 24000) => {
  const n = Math.floor((sr * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
  return b;
};

export function startMockGnani(port = 0, { transcript = 'Ramesh ko do sau udhaar likh do' } = {}) {
  const log = { frames: [], badFrames: 0, headers: {}, batchConfig: null };
  const readBody = (req) => new Promise((r) => {
    const parts = [];
    req.on('data', (d) => parts.push(d)).on('end', () => r(Buffer.concat(parts)));
  });

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const authed = req.headers['x-api-key-id'] === KEY;
    if (!authed && !req.url.startsWith('/files/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: { type: 'INVALID_API_KEY', message: 'bad key' } }));
    }
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/stt/v3') {
      log.headers.rest = req.headers['content-type'];
      log.restBody = body.toString('latin1');
      return json(200, { success: true, request_id: 'r1', transcript, model: 'prisma-v3.0', detected_language_code: 'hi-IN', processing_time: 0.3 });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tts/inference') {
      const j = JSON.parse(body.toString());
      log.lastTts = j;
      if (!j.audio_config) return json(400, { message: 'audio_config required' });
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      return res.end(pcmToWav(tone(300), j.audio_config.sample_rate));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tts/sse') {
      const j = JSON.parse(body.toString());
      log.lastSse = j;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: start\ndata: ${JSON.stringify({ status: 'streaming_started', text: j.text })}\n\n`);
      for (let i = 1; i <= 3; i++) res.write(`event: chunk\ndata: ${JSON.stringify({ chunk_index: i, audio: tone(100).toString('base64'), is_final: false })}\n\n`);
      return res.end(`event: complete\ndata: ${JSON.stringify({ chunk_index: 4, audio: '', is_final: true })}\n\n`);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tts/voice-clone/embeddings') {
      return json(200, { success: true, data: { voice_clone_embedding: { embedding: 'EMB123', shape: [1, 768], dtype: 'torch.bfloat16' } } });
    }
    // ---- Batch ----
    if (req.method === 'POST' && url.pathname === '/stt/v3/batch/jobs') {
      const text = body.toString('utf8');
      const m = text.match(/name="config"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/);
      log.batchConfig = m ? JSON.parse(m[1]) : null;
      log.batchHasFile = /name="files"; filename="/.test(text);
      return json(201, { job_id: 'job-1', status: 'CREATED', total_files_accepted: 1 });
    }
    if (req.method === 'POST' && url.pathname === '/stt/v3/batch/jobs/job-1/start') return json(202, { job_id: 'job-1', status: 'STARTING' });
    if (req.method === 'GET' && url.pathname === '/stt/v3/batch/jobs/job-1') return json(200, { job_id: 'job-1', status: 'COMPLETED', percent: 100 });
    if (req.method === 'GET' && url.pathname === '/stt/v3/batch/jobs/job-1/files') {
      return json(200, { job_id: 'job-1', files: [{ file_id: 'f1', status: 'COMPLETED', transcript_url: `http://localhost:${server.address().port}/files/t1.json` }] });
    }
    if (url.pathname === '/files/t1.json') {
      return json(200, {
        full_transcript: 'Haan ji bolo. Main Vikas, das kilo chawal 780 rupaye udhaar likh do.',
        duration_seconds: 12.5,
        segments: [
          { segment_id: 1, start_time: 0, end_time: 1, text: 'Haan ji bolo.', speaker_id: 0 },
          { segment_id: 2, start_time: 1, end_time: 6, text: 'Main Vikas, das kilo chawal 780 rupaye udhaar likh do.', speaker_id: 1 },
        ],
      });
    }
    json(404, { message: 'not found' });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers['x-api-key-id'] !== KEY) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (req.url === '/stt/v3/stream') {
        log.headers.stream = req.headers;
        ws.send(JSON.stringify({ type: 'connected', message: 'ok', config: { sample_rate: 16000, chunk_size: 1024 } }));
        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            log.frames.push(data.length);
            if (data.length !== 1024) log.badFrames++;
            return;
          }
          const m = JSON.parse(data.toString());
          if (m.type === 'commit') {
            ws.send(JSON.stringify({ type: 'processing', timestamp: Date.now() }));
            ws.send(JSON.stringify({ type: 'transcript', text: transcript, segment_id: 's1', is_final: true, detected_language_code: 'hi-IN', latency: 180 }));
          }
        });
      } else if (req.url === '/api/v1/tts') {
        ws.on('message', (data) => {
          const j = JSON.parse(data.toString());
          log.lastWsTts = j;
          ws.send(JSON.stringify({ type: 'start', message: 'Streaming started', request_id: 'req' }));
          for (let i = 1; i <= 2; i++) ws.send(JSON.stringify({ type: 'audio', data: { chunk_index: i, audio: tone(100).toString('base64'), is_final: false } }));
          ws.send(JSON.stringify({ type: 'complete', data: { chunk_index: 3, audio: '', is_final: true } }));
        });
      } else ws.close();
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ port: server.address().port, log, close: () => server.close() })));
}
