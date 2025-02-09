import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  startMachineCreationDetached,
  stopMachine,
  type VIDEO_SIZE,
} from "./flyMachines.js";
import { createHLSChunks } from "./video_utils.js";
import { uploadChunks } from "./utils/uploadChunks.js";

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

  if (!storageKey || !sizeName || !machineId) return c.text("Bad Request", 400);

  //  detached work...
  createHLSChunks({
    storageKey,
    sizeName,
    onFinish: async (playListPath: string) => {
      uploadChunks({
        storageKey,
        tempFolder: playListPath,
        async onEnd() {
          // @todo send request to webhook
          await stopMachine(machineId);
        },
      });
    },
    async onError(error) {
      console.log("ERROR_ROUTE_LEVEL:", error);
      // @todo send request to webhook
      await stopMachine(machineId);
    },
  });
  // stop machine?
  return c.text(`CONVERSION_${sizeName}_STARTED_FOR_${storageKey}`);
});

// 1. create the machine and wait for it to be ready
app.post("/start", async (c) => {
  const body = await c.req.json();
  const machineId = await startMachineCreationDetached(body);
  if (!machineId) {
    return c.text("Error on machine creation", {
      status: 500,
    });
  }
  return c.json({
    playlistURL: `https://fly.storage.tigris.dev/video-converter-hono/chunks/${body.storageKey}/${body.sizeName}.m3u8`,
    machineId,
    ...body,
  });
});

const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
