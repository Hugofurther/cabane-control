const dgram = require('dgram');
const server = dgram.createSocket('udp4');

server.on('error', (err) => {
    console.log(`Server error:\n${err.stack}`);
    server.close();
});

server.on('message', (msg, rinfo) => {
    console.log(`Packet received from ${rinfo.address}:${rinfo.port} - Header: 0x${msg[0].toString(16)}`);
});

server.on('listening', () => {
    const address = server.address();
    console.log(`Test Server listening ${address.address}:${address.port}`);
});

// Try binding to all interfaces
server.bind(8888, '0.0.0.0');