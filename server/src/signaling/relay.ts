import type { Socket, Server } from 'socket.io';

// server/src/signaling/relay.ts — WebRTC signaling relay (spec §7.5, §9.1)
export function registerSignaling(socket: Socket, io: Server) {
  socket.on('webrtc:offer', ({ code, offer }) => {
    socket.to(code).emit('webrtc:offer', { from: socket.id, offer });
  });
  socket.on('webrtc:answer', ({ code, answer }) => {
    socket.to(code).emit('webrtc:answer', { from: socket.id, answer });
  });
  socket.on('webrtc:ice', ({ code, candidate }) => {
    socket.to(code).emit('webrtc:ice', { from: socket.id, candidate });
  });
}
