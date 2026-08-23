import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL || '';

interface PeerPlayer { id: string; nickname: string }

interface Opts {
  socket: Socket | null;
  connected: boolean;
  code?: string;
  players: PeerPlayer[];
  localStream: MediaStream | null;
}

// Real P2P video between the two room players using the server's
// webrtc:offer/answer/ice relay. Perfect-negotiation pattern:
// deterministic polite/impolite roles from socket ids handle offer glare.
export function usePeerVideo({ socket, connected, code, players, localStream }: Opts) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;

  useEffect(() => {
    if (!connected || !socket || !code) return;

    let dead = false;
    const peer = players.length === 2 ? players.find(p => p.id !== socket.id) : null;
    // lexicographically smaller id initiates first; larger id is "polite" (yields on glare)
    const polite = peer ? socket.id! > peer.id : false;

    const drainIce = async () => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) return;
      const queued = pendingIceRef.current;
      pendingIceRef.current = [];
      for (const c of queued) {
        try { await pc.addIceCandidate(c); } catch {}
      }
    };

    const teardown = () => {
      const pc = pcRef.current;
      pcRef.current = null;
      setRemoteStream(null);
      if (pc) {
        pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; pc.onconnectionstatechange = null;
        try { pc.close(); } catch {}
      }
      pendingIceRef.current = [];
    };

    const buildPc = async (): Promise<RTCPeerConnection | null> => {
      if (pcRef.current || dead) return pcRef.current;
      let iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
      ];
      try {
        const res = await fetch(`${SERVER_URL}/api/turn-credentials`);
        if (res.ok) {
          const cfg = await res.json();
          if (cfg?.iceServers?.length) iceServers = cfg.iceServers;
        }
      } catch {}

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      pc.onicecandidate = e => {
        if (e.candidate) socket.emit('webrtc:ice', { code, candidate: e.candidate.toJSON() });
      };
      pc.ontrack = e => {
        const stream = e.streams[0];
        if (stream && !dead) setRemoteStream(stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          try { pc.restartIce?.(); } catch {}
        }
      };
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            socket.emit('webrtc:offer', { code, offer: pc.localDescription.toJSON() });
          }
        } catch {} finally {
          makingOfferRef.current = false;
        }
      };

      const stream = localStreamRef.current;
      if (stream && stream.getVideoTracks().length) {
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
      }
      return pc;
    };

    const onOffer = async ({ offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      const pc = await buildPc();
      if (!pc || dead) return;
      const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable';
      ignoreOfferRef.current = !polite && offerCollision;
      if (ignoreOfferRef.current) return;
      try {
        // implicit rollback resolves have-local-offer on the polite side
        await pc.setRemoteDescription(offer);
        await drainIce();
        if (offer.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            socket.emit('webrtc:answer', { code, answer: pc.localDescription.toJSON() });
          }
        }
      } catch {}
    };

    const onAnswer = async ({ answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(answer);
          await drainIce();
        }
      } catch {}
    };

    const onIce = async ({ candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        if (candidate) pendingIceRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {}
    };

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice', onIce);

    let timer: ReturnType<typeof setTimeout> | undefined;
    // kick off connection once both players are present
    if (peer) {
      if (!polite) {
        buildPc(); // fires negotiationneeded → offer
      } else {
        // polite side waits a beat so the initiator's offer usually wins the race
        timer = setTimeout(() => { if (!dead) buildPc(); }, 400 + Math.random() * 600);
      }
    }

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      teardown();
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice', onIce);
    };
  }, [socket, connected, code, players.map(p => p.id).join('|')]);

  // camera arrived late (permission granted after join) → attach & renegotiate
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !localStream) return;
    const hasVideoSender = pc.getSenders().some(s => s.track?.kind === 'video');
    if (!hasVideoSender && localStream.getVideoTracks().length) {
      try {
        for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      } catch {}
    }
  }, [localStream]);

  return { remoteStream };
}
