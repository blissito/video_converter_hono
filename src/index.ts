import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { startMachineCreationDetached, stopMachine } from "./flyMachines.js";
import { env } from "hono/adapter";
import dotenv from "dotenv";
dotenv.config();

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Blissmo");
});

// 2. receive internal request
app.post("/internal", async (c) => {
  console.log("Internal called!");
  const url = new URL(c.req.url);
  const storageKey = url.searchParams.get("storageKey");
  const machineId = url.searchParams.get("machineId");
  const size = url.searchParams.get("size");

  console.log("About to work hard! 🦾" + storageKey + size + machineId);
  //  detached work...
  // stop machine
  if (machineId) {
    await stopMachine(machineId);
  }
  return c.text("About to work hard!" + storageKey + size);
});

// 1. create the machine and wait it to be ready
app.post("/start", async (c) => {
  const body = await c.req.json();
  let taskId = "fakeTask2435_id";
  let status = "waiting";
  const { FLY_BEARER_TOKEN } = env<{ FLY_BEARER_TOKEN: string }>(c); // hono compatibility with may clouds
  const machineId = await startMachineCreationDetached(FLY_BEARER_TOKEN);

  if (!machineId) {
    return c.text("Error on machine creation", {
      status: 500,
    });
  }

  return c.json({
    machineId,
    taskId,
    status,
    ...body,
  });
});

const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
