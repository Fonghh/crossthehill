// Local PeerJS signalling server for LAN / dev testing (binds IPv4 so it works in containers).
//   npm run peer-server   → ws://<this-machine>:9000/cth
import http from 'node:http';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const port = Number(process.env.PORT ?? 9000);
const app = express();
const server = http.createServer(app);
app.use('/cth', ExpressPeerServer(server, { path: '/' }));
server.listen(port, '0.0.0.0', () => console.log(`PeerJS server on http://0.0.0.0:${port}/cth`));
