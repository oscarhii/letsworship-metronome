const assert = require('node:assert/strict');

const endpoint = process.env.SYNCBEAT_TEST_ENDPOINT || 'http://127.0.0.1:8787';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    socket.addEventListener('open', () => resolve({ socket, messages }));
    socket.addEventListener('error', reject, { once: true });
  });
}

async function take(client, type, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const index = client.messages.findIndex(message => message.type === type);
    if (index >= 0) return client.messages.splice(index, 1)[0];
    await wait(20);
  }
  throw new Error('Timed out waiting for ' + type);
}

(async () => {
  const health = await fetch(endpoint + '/health').then(response => response.json());
  assert.equal(health.ok, true);

  const roomResponse = await fetch(endpoint + '/api/rooms', { method: 'POST' });
  assert.equal(roomResponse.status, 200);
  const room = await roomResponse.json();
  assert.match(room.code, /^[A-Z2-9]{6}$/);

  const join = await fetch(endpoint + '/api/rooms/' + room.code + '/join', { method: 'POST' }).then(response => response.json());
  assert.equal(join.joinToken, room.joinToken);
  const wsBase = endpoint.replace(/^http/, 'ws') + '/api/rooms/' + room.code + '/websocket';
  const host = await openSocket(wsBase + '?token=' + room.hostToken + '&device=HOST');
  const followerA = await openSocket(wsBase + '?token=' + room.joinToken + '&device=A');
  const followerB = await openSocket(wsBase + '?token=' + room.joinToken + '&device=B');
  const hostWelcome = await take(host, 'WELCOME');
  const followerAWelcome = await take(followerA, 'WELCOME');
  const followerBWelcome = await take(followerB, 'WELCOME');

  host.socket.send(JSON.stringify({ type: 'SIGNAL', target: followerAWelcome.peerId, payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'test-offer' } } }));
  const offer = await take(followerA, 'SIGNAL');
  assert.equal(offer.from, hostWelcome.peerId);
  assert.equal(offer.payload.kind, 'offer');
  followerA.socket.send(JSON.stringify({ type: 'SIGNAL', target: hostWelcome.peerId, payload: { kind: 'answer', sdp: { type: 'answer', sdp: 'test-answer' } } }));
  const answer = await take(host, 'SIGNAL');
  assert.equal(answer.from, followerAWelcome.peerId);
  assert.equal(answer.payload.kind, 'answer');

  const state = { bpm: 128, beatsPerMeasure: 4, isPlaying: false };
  host.socket.send(JSON.stringify({ type: 'STATE', payload: state }));
  assert.deepEqual((await take(followerA, 'STATE')).payload, state);
  assert.deepEqual((await take(followerB, 'STATE')).payload, state);

  host.socket.send(JSON.stringify({ type: 'EVENT', payload: { action: 'TEMPO', bpm: 132 }, excludePeerIds: [followerAWelcome.peerId] }));
  assert.equal((await take(followerB, 'EVENT')).payload.bpm, 132);
  await wait(150);
  assert.equal(followerA.messages.some(message => message.type === 'EVENT'), false);

  followerA.socket.send(JSON.stringify({ type: 'EVENT', payload: { action: 'STOP' } }));
  await wait(150);
  assert.equal(host.messages.some(message => message.type === 'EVENT'), false);

  followerB.socket.close();
  await wait(100);
  const followerB2 = await openSocket(wsBase + '?token=' + room.joinToken + '&device=B');
  await take(followerB2, 'WELCOME');
  assert.deepEqual((await take(followerB2, 'STATE')).payload, state);

  host.socket.close();
  followerA.socket.close();
  followerB2.socket.close();
  console.log('Cloud room multi-device checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
