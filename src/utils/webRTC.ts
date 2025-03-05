export type Peer = {
  id: string;
  socket: WSContext<WebSocket>;
  roomId: string;
  isFirst: boolean;
};

export type Rooms = { [x: string]: Room };
export type Room = [Peer] | [Peer, Peer];

export type SwitchData = {
  socket: WSContext<WebSocket>;
  rooms: Rooms;
  data: any;
};

import fs from "fs";
import type { WSContext } from "hono/ws";
import { nanoid } from "nanoid";

const json = (data: Record<string, any>) => JSON.stringify(data);

export const handleJoin = ({ rooms, socket, data }: SwitchData) => {
  const { roomId } = data;
  const peer = createPeer(socket, roomId);
  console.info(`::NEW_PEER::${peer.id}::REQUESTED_ROOM::${roomId}`, rooms);
  // 1. get or create room
  if (rooms[roomId]) {
    if (rooms[roomId].length >= 2) {
      signal("rejected", socket, {});
      return;
    } else if (rooms[roomId]) {
      rooms[roomId][1] = peer;
      broadcast("peer_joined", rooms[roomId]);
      signal("create_offer", socket); // socket at hand 🤷🏻
    }
  } else {
    peer.isFirst = true; // is first
    rooms[roomId] = [peer];
  }
  let p = { ...peer, socket: undefined }; // avoid circular json
  signal("joined", socket, { roomId, p });
};

const signal = (
  intent: string,
  socket: WSContext<WebSocket>,
  data: any = {}
) => {
  socket.send(json({ ...data, intent }));
};

const broadcast = (intent: string, room: Room) => {
  room.map(({ socket }) => {
    signal(intent, socket, {
      participants: room.map((p) => p.id),
    });
  });
};

const createPeer = (socket: WSContext<WebSocket>, roomId: string) => ({
  id: nanoid(3),
  socket,
  roomId,
  isFirst: false,
});

////////////////////////////////

type Offer = {
  data: { description: unknown; roomId: string };
  socket: WSContext<WebSocket>;
  rooms: Rooms;
};
export const handleOffer = (options: Offer) => {
  const {
    rooms,
    data: { description, roomId },
  } = options || {};
  const room = rooms[roomId];
  signal("answer_the_offer", room[0].socket, { description });
};

export const handleAnswer = ({ data, socket, rooms }: SwitchData) => {
  const { description, roomId } = data;
  const room = rooms[roomId];
  if (!room || !room[1]) return; // @todo trigger rollback?
  // send answer to caller
  signal("connect", room[1].socket, { description });
  console.log("::CONNECT_SENT::");
};

export const handleCandidate = ({ rooms, data }: SwitchData) => {
  const { candidate, roomId } = data;
  const room = rooms[roomId];
  if (!room) return;

  room.forEach((p) => {
    signal("candidate", p.socket, { candidate });
  });
};

export const handleLeaveRoom = ({ sockets, roomId, peerId }: any) => {
  console.log("leaving");
  const participants = removePeer(roomId, peerId);
  // broadcast(sockets, {  roomId, intent: "peer_left" });
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
