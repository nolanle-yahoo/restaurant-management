const WebSocket = require('ws');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ server });
  wss.on('connection', ws => {
    ws._locId = null;
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'auth') ws._locId = msg.location_id || null;
      } catch {}
    });
    ws.on('error', () => {});
  });
}

function broadcast(event, data, locId = null) {
  if (!wss) return;
  const msg = JSON.stringify({ event, data });
  wss.clients.forEach(ws => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!locId || !ws._locId || String(ws._locId) === String(locId)) {
      ws.send(msg);
    }
  });
}

module.exports = { init, broadcast };
