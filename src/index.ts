import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  startMachineCreationDetached,
  stopMachine,
  type VIDEO_SIZE,
} from "./utils/flyMachines.js";
import { uploadChunks } from "./utils/uploadChunks.js";
import { createHLSChunks, transcodeDetached } from "./utils/video_utils.js";
import { getMasterFileString } from "./utils/getMasterFileResponse.js";
import { convertMP4, Version, type ConvertMP4Return } from "./lib/encoder.js";
import { fetchVideo } from "./utils/fetchVideo.js";

// @todo bearer token generation on a dashboard
const CONVERTION_TOKEN = process.env.CONVERTION_TOKEN;
const CHUNKS_HOST =
  "https://fly.storage.tigris.dev/video-converter-hono/chunks";

const app = new Hono();

// CORS should be called before the route
app.use(
  "*",
  cors({
    origin: "*",
  })
);

app.get("/", (c) => {
  return c.text("Hello Blissmo");
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
    eventName: "onEnd" | "onError",
    error?: string
  ) => {
    if (!webhook) return;

    const r = await fetch(webhook, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
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
    console.log("RESPONSE", r.ok, r.status, r.statusText);
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
      await callWebHook(
        "onError",
        (error instanceof Error ? error : new Error(String(error))).message
      );
      await stopMachine(machineId);
    },
  });
  // stop machine?
  return c.text(`TRANSCODING_STARTED_FOR_${storageKey}`);
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

const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
