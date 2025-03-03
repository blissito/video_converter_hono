type RoomHandler = {
  roomId: string;
  peerId: string;
  rooms: Map<string, { participants: Set<string> }>;
  socket: WebSocket;
};
import fs from "fs";

export const handleJoin = ({ roomId, peerId, socket, rooms }: RoomHandler) => {
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room!.participants.add(peerId);
    broadcast(socket, { peerId, roomId, intent: "peer_joined" });
  } else {
    rooms.set(roomId, { participants: new Set([peerId]) });
  }
};

export const handleLeaveRoom = ({
  socket,
  roomId,
  peerId,
  rooms,
}: RoomHandler) => {
  if (!rooms.has(roomId)) return console.warn("No Room Found: " + roomId);

  const room = rooms.get(roomId);
  room!.participants?.delete(peerId);
  rooms.set(roomId, room!);
  broadcast(socket, {
    roomId,
    peerId,
    intent: "peer_left",
  });
};

const broadcast = (
  socket: WebSocket,
  data: {
    roomId: string;
    peerId: string;
    intent: string;
    room?: { participants: Set<string> };
  }
) => {
  const { roomId, peerId, intent } = data || {};
  const dir = "rooms";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let participants;
  try {
    participants = fs.readFileSync("rooms/" + roomId, "utf-8");
  } catch (e) {
    console.error(e);
    fs.writeFileSync("rooms/" + roomId, `["${peerId}"]`);
  }
  participants = JSON.parse(fs.readFileSync("../" + roomId, "utf-8"));
  socket.send(
    JSON.stringify({
      participants,
      roomId,
      peerId,
      intent,
    })
  );
};
