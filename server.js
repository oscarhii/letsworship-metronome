const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Development/preview server only. Device synchronization is handled directly
// between browsers with WebRTC and never passes through this process.
app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, '127.0.0.1', () => {
  console.log('SyncBeat preview: http://localhost:' + port);
  console.log('Production installation is served as static files from GitHub Pages.');
});
