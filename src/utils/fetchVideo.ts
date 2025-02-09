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
};

// @todo: return cleanup!
export const fetchVideo = async (storageKey: string): Promise<VideoFetched> => {
  const tempPath = `temp/${nanoid(6)}/${storageKey}`;
  let getURL;
  try {
    getURL = await getReadURL(storageKey);
  } catch (e) {
    console.log("ERROROEL: ", e);
    throw new Error("::ERROR_GETTING_READ_URL_FOR" + storageKey);
  }
  const response = await fetch(getURL).catch((e) => console.error(e));
  console.log("::FILE_FETCHED::", response?.ok, storageKey);
  if (!response?.body) {
    return {
      contentLength: "",
      contentType: "",
      ok: false,
      tempPath: null,
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
