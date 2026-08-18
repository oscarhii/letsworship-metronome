const WebSocket = require('ws');

const ws = new WebSocket('wss://broker.emqx.io:8084/mqtt', ['mqtt']);
ws.on('open', () => {
  console.log('✅ Connected to EMQX public MQTT WebSocket successfully!');
  ws.close();
});
ws.on('error', (err) => {
  console.error('❌ MQTT WS Error:', err);
});
