import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  startMachineCreationDetached,
  stopMachine,
  type VIDEO_SIZE,
} from "./flyMachines.js";
import { env } from "hono/adapter";
import dotenv from "dotenv";
import { createHLSChunks } from "./video_utils.js";
dotenv.config();

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

  if (!storageKey || !sizeName || !machineId) return c.text("Bad Request", 400);

  //  detached work...
  console.info("::DETACHING_VIDEO_CONVERTION::", machineId);
  createHLSChunks({
    storageKey,
    sizeName,
    onFinish: async (playListPath: string) => {
      console.log("TODOS LOS CHUNKS AQUI: ", playListPath);
      await stopMachine(machineId);
      console.info("No se quiere apagar");
    },
    async onError(error) {
      console.log("ERROR_ROUTE_LEVEL:", error);
      await stopMachine(machineId);
    },
  });
  // stop machine?
  return c.text("OK");
});

// 1. create the machine and wait it to be ready
app.post("/start", async (c) => {
  const body = await c.req.json();
  const { FLY_BEARER_TOKEN } = env<{ FLY_BEARER_TOKEN: string }>(c); // hono compatibility with may clouds
  const machineId = await startMachineCreationDetached(body, FLY_BEARER_TOKEN);

  if (!machineId) {
    return c.text("Error on machine creation", {
      status: 500,
    });
  }

  return c.json({
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
