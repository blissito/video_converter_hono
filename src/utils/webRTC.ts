type RoomHandler = {
  roomId: string;
  peerId: string;
  sockets: WSContext<WebSocket>[];
};
import fs from "fs";
import type { WSContext } from "hono/ws";

const json = (data: Record<string, any>) => JSON.stringify(data);

export const handleJoin = ({ sockets, roomId, peerId }: RoomHandler) => {
  const participants = addPeer(roomId, peerId);
  broadcast(sockets, { participants, roomId, intent: "peer_joined", peerId });
};

type Offer = {
  roomId?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  socket: WSContext<WebSocket>;
  sockets: WSContext<WebSocket>[];
};
export const handleOffer = (options: Offer) => {
  const { sockets, description } = options || {};
  // only firts client
  sockets[0].send(
    json({
      intent: "offer",
      description,
    })
  );
};

export const handleAnswer = ({
  description,
  socket,
  sockets,
}: {
  description: RTCSessionDescriptionInit;
  socket: WSContext<WebSocket>;
  sockets: WSContext<WebSocket>[];
}) => {
  // only to guest
  sockets[1].send(
    json({
      intent: "answer",
      description,
    })
  );
};

export const handleCandidate = ({
  sockets,
  candidate,
}: {
  candidate: RTCIceCandidateInit;
  sockets: WSContext<WebSocket>[];
}) => {
  sockets.forEach((s) => s.send(json({ candidate, intent: "candidate" })));
};

export const handleLeaveRoom = ({ sockets, roomId, peerId }: RoomHandler) => {
  console.log("leaving");
  const participants = removePeer(roomId, peerId);
  broadcast(sockets, { peerId, participants, roomId, intent: "peer_left" });
};

const broadcast = (
  sockets: WSContext<WebSocket>[],
  data: {
    roomId: string;
    participants: string[];
    intent: string;
    peerId?: string;
  }
) => {
  const { roomId, participants, intent, peerId } = data || {};
  sockets.map((socket) => {
    socket.send(
      json({
        participants,
        roomId,
        intent,
        peerId,
      })
    );
  });
};

const addPeer = (roomId: string, peerId: string) => {
  const dir = "rooms/";
  const key = dir + roomId;
  let participants;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    participants = fs.readFileSync(key, "utf-8");
  } catch (e) {
    fs.writeFileSync(key, `[]`);
    console.info("::Room created::", roomId);
  }
  participants = JSON.parse(fs.readFileSync(key, "utf-8"));
  participants = participants.length < 1 ? [peerId] : [participants[0], peerId]; // revisit
  fs.writeFileSync(key, JSON.stringify(participants));
  return participants;
};

const removePeer = (roomId: string, peerId: string) => {
  const dir = "rooms/";
  const key = dir + roomId;
  let participants;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    participants = fs.readFileSync(key, "utf-8");
  } catch (e) {
    console.info("::Room created::", roomId);
    fs.writeFileSync(key, `[]`);
  }
  participants = JSON.parse(fs.readFileSync(key, "utf-8")) as string[];
  participants = participants.filter((id) => id !== peerId);
  fs.writeFileSync(key, JSON.stringify(participants));
  return participants;
};

const getRoom = (roomId: string) => {
  const dir = "rooms/";
  const key = dir + roomId;
  let participants;
  try {
    participants = fs.readFileSync(key, "utf-8");
  } catch (e) {
    participants = "[]";
  }
  return JSON.parse(participants);
};
