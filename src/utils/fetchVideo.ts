import fs, { WriteStream } from "fs";
import { finished } from "stream/promises";
import { Readable } from "stream";
import { getReadURL } from "react-hook-multipart";
import path from "path";
import { nanoid } from "nanoid";
import dotenv from "dotenv";
dotenv.config();

export type VideoFetched = {
  contentLength: string;
  contentType: string;
  ok: boolean;
  tempPath: string | null;
  fileStream?: WriteStream;
  error?: Error;
};

// @todo: return cleanup!
export const fetchVideo = async (
  storageKey: string,
  Bucket: string | null = "easybits-dev"
): Promise<VideoFetched> => {
  const tempPath = `temp/${nanoid(6)}/${storageKey}`;
  let getURL;
  console.log("PROVIDER_BUCKET:_", Bucket);
  getURL = await getReadURL(storageKey, 900, { Bucket });
  const response = await fetch(getURL);
  console.log("::FILE_FETCHED::", response.status, storageKey);
  if (!response?.body || !response.ok) {
    return {
      contentLength: "",
      contentType: "",
      ok: false,
      tempPath: null,
      error: new Error(response.status),
    };
  }
  //  create temp directory
  const __dirname = path.dirname(tempPath);
  if (!fs.existsSync(__dirname)) {
    fs.mkdirSync(__dirname, { recursive: true });
  }
  // @todo try with a Buffer?
  const fileStream = fs.createWriteStream(tempPath); // la cajita (en disco) puede ser un Buffer 🧐
  await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
  // console.info("FILE STATS: ", fs.statSync(tempPath));
  return {
    contentLength: response.headers.get("content-length") || "",
    contentType: response.headers.get("content-type") || "",
    ok: response.ok,
    tempPath,
    fileStream,
  };
};
