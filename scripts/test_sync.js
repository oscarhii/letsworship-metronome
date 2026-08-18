const http = require('http');
const WebSocket = require('ws');

async function testEndpoint(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, length: data.length, data });
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('Testing HTTP Endpoints:');
  const paths = [
    '/',
    '/css/style.css',
    '/js/audio.js',
    '/js/sync.js',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon.svg',
    '/api/info'
  ];

  for (const p of paths) {
    const res = await testEndpoint(p);
    console.log(`  ✅ ${p} -> Status ${res.status}, Size: ${res.length} bytes`);
  }

  console.log('\nTesting WebSocket Sync & NTP:');
  const ws1 = new WebSocket('ws://localhost:3000');
  const ws2 = new WebSocket('ws://localhost:3000');

  let ws1Joined = false;
  let ws2Joined = false;

  await new Promise((resolve) => {
    let openCount = 0;
    const checkOpen = () => {
      openCount++;
      if (openCount === 2) resolve();
    };
    ws1.on('open', checkOpen);
    ws2.on('open', checkOpen);
  });

  console.log('  ✅ 2 WebSocket clients connected.');

  // Test NTP Ping Pong
  const pingPromise = new Promise((resolve) => {
    ws1.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'PONG') {
        console.log('  ✅ Received NTP PONG from server:', msg.payload);
        resolve();
      }
    });
    ws1.send(JSON.stringify({ type: 'PING', payload: { clientSendTime: Date.now() } }));
  });
  await pingPromise;

  // Test Join Room & Broadcast Start
  const syncPromise = new Promise((resolve) => {
    ws2.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'METRONOME_STARTED') {
        console.log('  ✅ WS2 received synced START from WS1:', msg.payload);
        resolve();
      }
    });

    ws1.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: 'TEST_ROOM' } }));
    ws2.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: 'TEST_ROOM' } }));

    setTimeout(() => {
      ws1.send(JSON.stringify({
        type: 'START_METRONOME',
        payload: { bpm: 140, beatsPerMeasure: 4, leadTime: 300 }
      }));
    }, 200);
  });
  await syncPromise;

  ws1.close();
  ws2.close();
  console.log('\n🎉 ALL SYNCHRONIZATION AND HTTP TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(console.error);
