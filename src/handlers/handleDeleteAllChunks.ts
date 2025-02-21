// @ts-ignore
import { listObjectsInFolder, deleteObjects } from "react-hook-multipart";
import type { Context } from "hono";
import { callWebHook } from "../utils/callWebhook.js";
import { agendar } from "../utils/agendar.js";

type S3Object = {
  Key: string;
  LastModified: Date;
  ETag: string;
  Size: number;
  StorageClass: string;
  Owner: unknown;
};
type ListResponse = {
  KeyCount: number;
  Name: string;
  Prefix: string;
  IsTruncated: boolean;
  httpStatusCode: number;
  Contents: S3Object[];
};
type DeleteResponse = {
  httpStatusCode: number;
  requestId: string;
  attempts: number;
  totalRetryDelay: number;
  Deleted: S3Object[];
};

export const handleDeleteAllChunks = async (c: Context) => {
  const AuthToken = c.req.header("Authorization");
  // @todo correct auth middleware?
  // @todo publishable key
  if (AuthToken !== "Bearer PerroTOken")
    return c.text("Token is missing:" + AuthToken, 403);

  const storageKey = c.req.query("storageKey");
  const webhook = c.req.query("webhook");
  if (!storageKey) return c.text("No storageKey", 400);

  const path = `chunks/${storageKey}/`;
  const list = await listObjectsInFolder(path);
  if (list.KeyCount < 1) {
    return c.text("Empty Folder", 404);
  }

  agendar(async () => {
    webhook &&
      (await callWebHook({
        webhook,
        eventName: "onStart",
        storageKey,
      }));

    console.info("::ABOUT_TO_DELETE_OBJECTS::", list.KeyCount);
    const resul = await deleteObjects(undefined, list.Contents);
    console.info(
      "::OBJECTS_DELETED::",
      resul.Deleted.length,
      "webhook::" + webhook
    );
    webhook &&
      (await callWebHook({
        webhook,
        eventName: "onDelete",
        storageKey,
      }));
  });
  return c.text("Deleting");
};
