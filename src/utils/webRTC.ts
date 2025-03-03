type RoomHandler = {
  roomId: string;
  peerId: string;
  rooms: Map<string, { participants: Set<string> }>;
  sockets: WSContext<WebSocket>[];
};
import fs from "fs";
import type { WSContext } from "hono/ws";

export const handleJoin = ({ sockets, roomId, peerId, rooms }: RoomHandler) => {
  const participants = addPeer(roomId, peerId);
  broadcast(sockets, { participants, roomId, intent: "peer_joined", peerId });
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
      JSON.stringify({
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
    console.info("::Room created::", roomId);
    fs.writeFileSync(key, `[]`);
  }
  participants = JSON.parse(fs.readFileSync(key, "utf-8"));
  participants.push(peerId);
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
