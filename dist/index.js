// src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
var app = new Hono();
app.get("/", (c) => {
  return c.text("Hello Hono!");
});
var port = 3e3;
console.log(`Server is running on http://localhost:${port}`);
serve({
  fetch: app.fetch,
  port
});
