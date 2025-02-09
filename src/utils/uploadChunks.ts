import { getPutFileUrl } from "react-hook-multipart";
import fs from "fs";
import path from "path";

export const uploadChunks = async ({
  storageKey,
  tempFolder,
  cleanUp = true,
  onEnd,
}: {
  tempFolder: string;
  storageKey: string;
  cleanUp?: boolean;
  onEnd?: () => void;
}) => {
  if (!fs.existsSync(tempFolder)) {
    return console.error("FOLDER_NOT_FOUND::", tempFolder);
  }
  const chunkPaths = fs
    .readdirSync(tempFolder)
    .map((fileName) => path.join(tempFolder, fileName));
  console.info(chunkPaths, "::ALL_CHUNKS_READY::");
  console.info("UPLOADING_FILES::", chunkPaths.length);

  //  'temp/chunks/suptm.mp4/480p/480p.m3u8',
  const promises = chunkPaths.map(async (chunkPath) => {
    const chunkPathArray = chunkPath.split("/");
    const fileName = chunkPathArray[chunkPathArray.length - 1];
    const putURL = await getPutFileUrl(`chunks/${storageKey}/${fileName}`);
    const file = fs.readFileSync(chunkPath);
    const r = await put({
      file,
      putURL,
    });
    if (cleanUp) fs.rmSync(chunkPath, { recursive: true, force: true });
    return r;
  });
  await Promise.all(promises);
  //   for await (let chunkPath of chunkPaths) {
  //     // @todo, try/catch?
  //     let cloudPath: string[] | string = chunkPath.split("/").slice(1); // remove temp/
  //     cloudPath.splice(cloudPath.length - 2, 1); // remove size/
  //     cloudPath = cloudPath.join("/"); // chunks/:storageKey/(size)p_(d+).(m3u8|ts)
  //     console.log("::CLOUD_PATH::", cloudPath);
  //     const putURL = await getPutFileUrl(cloudPath);
  //     const file = fs.readFileSync(chunkPath);
  //     // @todo retry
  //     const response = await put({
  //       file,
  //       putURL,
  //     });

  //     if (response.status === 403) {
  //       console.log("UPLOAD_FORBIDDEN::", response.statusText);
  //       break;
  //     }
  //     if (cleanUp) {
  //       fs.rmSync(chunkPath, { recursive: true, force: true });
  //     }
  //   }
  console.log(`ALL_CHUNKS_UPLOADED ${chunkPaths.length} for: ${tempFolder}`);
  // update db stuff
  await onEnd?.();
};

const put = ({
  file,
  contentType = "application/x-mpegURL",
  putURL,
}: {
  file: Buffer<ArrayBufferLike>;
  contentType?: string;
  putURL: string;
}) =>
  fetch(putURL, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Length": Buffer.byteLength(file).toString(),
      "Content-Type": contentType,
    },
  });
