import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  startMachineCreationDetached,
  stopMachine,
} from "./utils/flyMachines.js";
import { uploadChunks } from "./utils/uploadChunks.js";
import { transcodeDetached } from "./utils/video_utils.js";
import { getMasterFileString } from "./utils/getMasterFileResponse.js";
import { convertMP4, Version, type ConvertMP4Return } from "./lib/encoder.js";
import { fetchVideo } from "./utils/fetchVideo.js";
import { handleDeleteAllChunks } from "./handlers/handleDeleteAllChunks.js";
import { readFileSync, writeFileSync } from "fs";
import { createNodeWebSocket } from "@hono/node-ws";
import path from "path";
import {
  handleAnswer,
  handleCandidate,
  handleJoin,
  handleLeaveRoom,
  handleOffer,
} from "./utils/webRTC.js";
import type { WSContext } from "hono/ws";

// @todo bearer token generation on a dashboard
const CONVERTION_TOKEN = process.env.CONVERTION_TOKEN;
const CHUNKS_HOST =
  "https://fly.storage.tigris.dev/video-converter-hono/chunks";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// CORS should be called before the route
app.use(
  "*",
  cors({
    origin: "*",
  })
);

app.use(
  "*",
  serveStatic({
    root: "./public",
  })
);

const rooms = new Map();
type SocketMessage = {
  intent: string;
  peerId: string;
  roomId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
// signaling stuff with hono helper socket
const sockets: WSContext<WebSocket>[] = []; // @todo perr room
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    return {
      onMessage(event, socket) {
        const { peerId, roomId, intent, description, candidate } = JSON.parse(
          event.data as string
        ) as SocketMessage;
        switch (intent) {
          case "join":
            sockets.push(socket);
            handleJoin({ sockets, roomId, peerId });
            break;
          case "leave_room":
            handleLeaveRoom({ sockets, roomId, peerId });
            break;
          case "offer":
            handleOffer({
              description,
              socket,
              sockets,
            });
            break;
          case "answer":
            handleAnswer({ description, socket, sockets });
            break;
          case "candidate":
            handleCandidate({ candidate, sockets });
        }
      },
    };
  })
);

app.get("/", (c) => {
  const html = readFileSync(path.resolve("src/templates/live.html"));
  return c.html(html.toString());
});

let segmentCounter = 0; // @todo should be db
const getSegmentCounter = () => segmentCounter;
const setSegmentCounter = (number: number) => (segmentCounter = number);
app.get("/fake_event.m3u8", (c) => {
  const addSegment = () => {
    //     if (getSegmentCounter() === 0) {
    //       writeFileSync(
    //         "public/event.m3u8",
    //         `#EXTM3U
    // #EXT-X-PLAYLIST-TYPE:EVENT
    // #EXT-X-VERSION:6
    // #EXT-X-TARGETDURATION:6
    // #EXT-X-MEDIA-SEQUENCE:0
    // #EXT-X-INDEPENDENT-SEGMENTS`,
    //         "utf-8"
    //       );
    //     }
    console.log("Segment");
    const m3u8String = readFileSync(path.resolve("public/event.m3u8"), "utf-8");
    const segments = [
      ["#EXTINF:6.400000,", "stream_0_0000.ts"],
      ["#EXTINF:5.600000,", "stream_0_0001.ts"],
      ["#EXTINF:3.000000,", "stream_0_0002.ts"],
      ["#EXTINF:3.000000,", "stream_3_0020.ts"],
      ["#EXTINF:6.400000,", "stream_3_0021.ts"],
      ["#EXTINF:6.400000,", "stream_3_0022.ts"],
      ["#EXTINF:5.600000,", "stream_3_0023.ts"],
      ["#EXTINF:6.400000,", "stream_3_0024.ts"],
      ["#EXTINF:5.600000,", "stream_3_0025.ts"],
    ];
    const segmentToInject = segments[segmentCounter].join("\n");
    const appendedList = m3u8String + "\n" + segmentToInject;
    writeFileSync("public/event.m3u8", appendedList, "utf-8");
    console.log("Avers", getSegmentCounter());
    setSegmentCounter(getSegmentCounter() + 1);
    if (getSegmentCounter() >= segments.length) {
      setSegmentCounter(0);
      const appendedList = m3u8String + "\n" + "#EXT-X-ENDLIST";
      // writeFileSync("public/event.m3u8", appendedList, "utf-8");
      console.log("Finished", "#EXT-X-ENDLIST");
      return;
    }
    setTimeout(addSegment, 6000);
  };
  const m3u8String = readFileSync(path.resolve("public/event.m3u8"), "utf-8");
  if (getSegmentCounter() !== 0) {
    console.log("Avoided", getSegmentCounter());
  } else {
    addSegment();
  }
  return c.text(m3u8String);
});

// 2. receive internal request
app.post("/internal", async (c) => {
  const url = new URL(c.req.url);
  const storageKey = url.searchParams.get("storageKey") as string;
  const machineId = url.searchParams.get("machineId") as string;
  const webhook = url.searchParams.get("webhook") as string;
  const Bucket = url.searchParams.get("Bucket") as string;

  if (!storageKey || !machineId) return c.text("Bad Request", 400);

  const callWebHook = async (
    eventName: "onEnd" | "onError" | "onStart",
    error?: string
  ) => {
    if (!webhook) return;

    const r = await fetch(webhook, {
      method: "put",
      body: new URLSearchParams({
        error: error || "0",
        eventName,
        storageKey,
        token: CONVERTION_TOKEN as string,
        masterPlaylistContent: getMasterFileString({
          versions: ["360p", "480p", "720p", "1080p"],
          storageKey,
        }),
        masterPlaylistURL: `${CHUNKS_HOST}/${storageKey}/main.m3u8`,
      }),
    });
    console.info(`::WEBHOOK_RESPONSE::${r.ok}::${r.status}::${r.statusText}::`);
    return r;
  };

  //  detached work...
  transcodeDetached({
    Bucket, // @todo revisit used in fetchVideo
    storageKey,
    onEnd: async (playListPath: string) => {
      uploadChunks({
        storageKey,
        tempFolder: playListPath,
        async onEnd() {
          // @todo generate master playlist and upload it?
          await callWebHook("onEnd");
          await stopMachine(machineId);
        },
      });
    },
    async onError(error) {
      console.info("HANDLING_ERROR");
      await callWebHook(
        "onError",
        (error instanceof Error ? error : new Error(String(error))).message
      );
      await stopMachine(machineId);
    },
    async onStart() {
      await callWebHook("onStart");
    },
  });
  // stop machine?
  return c.text(`TRANSCODING_STARTED_FOR_${storageKey}`);
});

// 1. create the machine and wait for it to be ready
app.post("/start", async (c) => {
  const body = await c.req.json();
  const AuthToken = c.req.header("Authorization");
  // @todo correct auth middleware?
  if (AuthToken !== "Bearer PerroTOken") return c.text("Forbidden", 403);

  const { machineId, machineName } = await startMachineCreationDetached(body);
  if (!machineId) {
    return c.text("Error on machine creation", {
      status: 500,
    });
  }
  return c.json({
    playlistURL: `https://fly.storage.tigris.dev/video-converter-hono/chunks/${body.storageKey}/main.m3u8`,
    machineId,
    machineName,
    ...body,
  });
});

app.post("/test", async (c) => {
  const storageKey = await c.req.query("storageKey");
  if (!storageKey) return c.text("Bad Request", 400);

  const response = await fetch(
    "https://easybits.cloud/api/v1/conversion_webhook",
    {
      method: "PUT",
      body: new URLSearchParams({
        storageKey,
        token: "pelusina69",
      }),
    }
  );
  return c.json(response);
});

app.post("/multiple_test", async (c) => {
  const storageKey = c.req.query("storageKey");
  const bucket = c.req.query("bucket");
  if (!storageKey || !bucket)
    return c.text("Bad Request::" + storageKey + "::" + bucket, 400);

  const { tempPath, ok, error } = await fetchVideo(storageKey, bucket);
  if (!ok || !tempPath)
    return c.text("::Error on fetching video::" + error?.message, 500);
  // needs to be in this order to upload correctly...
  const versions = [Version.MOBILE, Version.SD, Version.HD, Version.FULL_HD];
  convertMP4({
    storageKey,
    versions,
    videoSourcePath: tempPath,
    onEnd: async ({ hlspath }: ConvertMP4Return) => {
      console.log("WTF?::HLSPATH", hlspath);
      await uploadChunks({
        storageKey,
        tempFolder: hlspath!,
        onEnd: () => {
          // update db / webhook
          console.log("Webhook, We'r all set!");
        },
      });
    },
  });
  return c.json({
    status: "working",
    storageKey,
    versions,
  });
});

app.delete("/delete_all", handleDeleteAllChunks);

const port = 8000;
console.log(`Server is running on http://localhost:${port}`);
// serve({
//   fetch: app.fetch,
//   port,
// });
const server = serve({
  fetch: app.fetch,
  port,
});
injectWebSocket(server);
