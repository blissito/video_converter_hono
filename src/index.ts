import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  startMachineCreationDetached,
  stopMachine,
  type VIDEO_SIZE,
} from "./utils/flyMachines.js";
import { uploadChunks } from "./utils/uploadChunks.js";
import { createHLSChunks } from "./utils/video_utils.js";
import { getMasterFileString } from "./utils/getMasterFileResponse.js";
import { fetchVideo } from "./utils/fetchVideo.js";

// @todo bearer token generation on a dashboard
const CONVERTION_TOKEN = process.env.CONVERTION_TOKEN;
const CHUNKS_HOST =
  "https://fly.storage.tigris.dev/video-converter-hono/chunks";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Blissmo");
});

// 2. receive internal request
app.post("/internal", async (c) => {
  const url = new URL(c.req.url);
  const storageKey = url.searchParams.get("storageKey");
  const machineId = url.searchParams.get("machineId");
  const sizeName = url.searchParams.get("sizeName") as VIDEO_SIZE;
  const webhook = url.searchParams.get("webhook");
  const Bucket = url.searchParams.get("Bucket");

  if (!storageKey || !sizeName || !machineId) return c.text("Bad Request", 400);

  const callWebHook = async (
    eventName: "onEnd" | "onError",
    error?: unknown
  ) => {
    webhook &&
      (await fetch(webhook, {
        method: "post",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          masterPlaylistURL: `${CHUNKS_HOST}/${storageKey}/main.m3u8`, // @todo revisit
          masterPlaylistContent: getMasterFileString({
            versions: [sizeName],
            storageKey,
          }),
          token: CONVERTION_TOKEN,
          storageKey,
          eventName,
          sizeName,
          error,
        }),
      }));
  };

  //  detached work...
  createHLSChunks({
    Bucket, // @todo revisit used in fetchVideo
    storageKey,
    sizeName,
    onFinish: async (playListPath: string) => {
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
      await callWebHook("onError", error);
      await stopMachine(machineId);
    },
  });
  // stop machine?
  return c.text(`CONVERSION_${sizeName}_STARTED_FOR_${storageKey}`);
});

// 1. create the machine and wait for it to be ready
app.post("/start", async (c) => {
  const body = await c.req.json();
  const AuthToken = c.req.header("Authorization");
  // @todo correct auth
  if (AuthToken !== "Bearer PerroTOken") return c.text("Forbidden", 403);

  const { machineId, machineName } = await startMachineCreationDetached(body);
  if (!machineId) {
    return c.text("Error on machine creation", {
      status: 500,
    });
  }
  return c.json({
    playlistURL: `https://fly.storage.tigris.dev/video-converter-hono/chunks/${body.storageKey}/${body.sizeName}.m3u8`,
    machineId,
    machineName,
    ...body,
  });
});

app.get("/test", async (c) => {
  const storageKey = await c.req.query("storageKey");
  if (!storageKey) return c.text("Bad Request", 400);

  const temp = await fetchVideo(storageKey, "easybits-dev");
  return c.json(temp);
});

const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
