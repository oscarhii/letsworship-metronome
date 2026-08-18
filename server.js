const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get local network IP addresses
// Helper to get and prioritize local physical network IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const physicalList = [];
  const virtualList = [];

  const virtualPatterns = /vethernet|wsl|vmware|virtualbox|vbox|docker|hyper-v|tailscale|tap|tun|pseudo|loopback/i;
  const wifiPatterns = /wi-fi|wlan|wireless|airport/i;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip non-IPv4, loopback, or APIPA link-local (169.254.x.x)
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        const isVirtual = virtualPatterns.test(name);
        const isWifi = wifiPatterns.test(name);

        const entry = {
          interface: name,
          ip: iface.address,
          isWifi,
          isVirtual
        };

        if (isVirtual) {
          virtualList.push(entry);
        } else {
          physicalList.push(entry);
        }
      }
    }
  }

  // Sort: Wi-Fi first, then other physical (Ethernet), then virtual
  physicalList.sort((a, b) => {
    if (a.isWifi && !b.isWifi) return -1;
    if (!a.isWifi && b.isWifi) return 1;
    return 0;
  });

  return [...physicalList, ...virtualList];
}

// API to get network info & QR codes for easy mobile Wi-Fi connection
app.get('/api/info', async (req, res) => {
  const ips = getLocalIpAddresses();
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol;

  const qrList = await Promise.all(
    ips.map(async (item) => {
      const url = `http://${item.ip}:${PORT}`;
      try {
        const qrDataUrl = await QRCode.toDataURL(url, {
          margin: 2,
          color: {
            dark: '#00f2fe',
            light: '#0a0e1a'
          }
        });
        return {
          ...item,
          url,
          qr: qrDataUrl
        };
      } catch (err) {
        return { ...item, url, qr: null };
      }
    })
  );

  res.json({
    port: PORT,
    ips: qrList,
    serverTime: Date.now()
  });
});

// Rooms state management
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      clients: new Set(),
      state: {
        isPlaying: false,
        bpm: 120,
        beatsPerMeasure: 4,
        startMasterTime: null,
        soundType: 'synth'
      }
    });
  }
  return rooms.get(roomId);
}

function broadcastToRoom(room, message, excludeWs = null) {
  const payload = JSON.stringify(message);
  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastRoomStats(room) {
  broadcastToRoom(room, {
    type: 'ROOM_STATS',
    payload: {
      deviceCount: room.clients.size
    }
  });
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let deviceId = Math.random().toString(36).substring(2, 9);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      const { type, payload } = message;

      switch (type) {
        // High-precision NTP ping-pong for clock synchronization
        case 'PING': {
          ws.send(JSON.stringify({
            type: 'PONG',
            payload: {
              clientSendTime: payload.clientSendTime,
              serverReceiveTime: Date.now()
            }
          }));
          break;
        }

        // Join room
        case 'JOIN_ROOM': {
          const roomId = (payload && payload.roomId ? payload.roomId.trim().toUpperCase() : 'MAIN') || 'MAIN';
          currentRoom = getOrCreateRoom(roomId);
          currentRoom.clients.add(ws);

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            payload: {
              roomId: currentRoom.id,
              deviceId,
              state: currentRoom.state,
              deviceCount: currentRoom.clients.size,
              serverTime: Date.now()
            }
          }));

          broadcastRoomStats(currentRoom);
          break;
        }

        // Start metronome playback synced across devices
        case 'START_METRONOME': {
          if (!currentRoom) return;
          // Target start time is 400ms ahead in master time to give all devices time to schedule ahead
          const leadTime = payload.leadTime || 400;
          const startMasterTime = Date.now() + leadTime;

          currentRoom.state.isPlaying = true;
          currentRoom.state.bpm = payload.bpm || currentRoom.state.bpm;
          currentRoom.state.beatsPerMeasure = payload.beatsPerMeasure || currentRoom.state.beatsPerMeasure;
          currentRoom.state.startMasterTime = startMasterTime;

          broadcastToRoom(currentRoom, {
            type: 'METRONOME_STARTED',
            payload: {
              startMasterTime,
              bpm: currentRoom.state.bpm,
              beatsPerMeasure: currentRoom.state.beatsPerMeasure,
              initiatedBy: deviceId
            }
          });
          break;
        }

        // Stop metronome playback
        case 'STOP_METRONOME': {
          if (!currentRoom) return;
          currentRoom.state.isPlaying = false;
          currentRoom.state.startMasterTime = null;

          broadcastToRoom(currentRoom, {
            type: 'METRONOME_STOPPED',
            payload: {
              initiatedBy: deviceId
            }
          });
          break;
        }

        // Tempo update
        case 'SET_TEMPO': {
          if (!currentRoom) return;
          currentRoom.state.bpm = payload.bpm;
          
          // If already playing, we calculate a seamless phase-aligned startMasterTime
          if (currentRoom.state.isPlaying) {
            const leadTime = 300;
            currentRoom.state.startMasterTime = Date.now() + leadTime;
          }

          broadcastToRoom(currentRoom, {
            type: 'TEMPO_UPDATED',
            payload: {
              bpm: currentRoom.state.bpm,
              startMasterTime: currentRoom.state.startMasterTime,
              initiatedBy: deviceId
            }
          });
          break;
        }

        // Beats per measure update (e.g. 2, 3, 4, 6)
        case 'SET_BEATS': {
          if (!currentRoom) return;
          currentRoom.state.beatsPerMeasure = payload.beatsPerMeasure;

          broadcastToRoom(currentRoom, {
            type: 'BEATS_UPDATED',
            payload: {
              beatsPerMeasure: currentRoom.state.beatsPerMeasure,
              initiatedBy: deviceId
            }
          });
          break;
        }

        // Sound style update
        case 'SET_SOUND': {
          if (!currentRoom) return;
          currentRoom.state.soundType = payload.soundType;

          broadcastToRoom(currentRoom, {
            type: 'SOUND_UPDATED',
            payload: {
              soundType: currentRoom.state.soundType,
              initiatedBy: deviceId
            }
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.clients.delete(ws);
      if (currentRoom.clients.size === 0) {
        rooms.delete(currentRoom.id);
      } else {
        broadcastRoomStats(currentRoom);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Sync Metronome Server running at http://localhost:${PORT}`);
  const ips = getLocalIpAddresses();
  if (ips.length > 0) {
    console.log(`📱 Connect your phones/tablets on the same Wi-Fi:`);
    ips.forEach((item) => {
      console.log(`   👉 http://${item.ip}:${PORT} (${item.interface})`);
    });
  } else {
    console.log(`📱 Connect on local network using your machine's Wi-Fi IP.`);
  }
  console.log(``);
});
