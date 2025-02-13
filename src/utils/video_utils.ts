import { Agenda } from "@hokify/agenda";
import fs from "fs";
import Ffmpeg from "fluent-ffmpeg";
import type { VIDEO_SIZE } from "./flyMachines.js";
import { fetchVideo } from "./fetchVideo.js";

export const CHUNKS_FOLDER = "chunks"; // @todo

export const createHLSChunks = async ({
  sizeName = "360p",
  storageKey,
  when = "in 1 second",
  onError,
  onFinish,
  Bucket,
}: {
  Bucket?: string | null;
  onError?: (error: unknown) => void;
  when?: string;
  sizeName?: VIDEO_SIZE;
  storageKey: string;
  onFinish: (playListPath: string) => void;
}) => {
  const agenda = new Agenda({
    db: { address: process.env.DATABASE_URL as string },
  });
  // agenda schedule definition
  agenda.define("generate_hls_chunks", async (job) => {
    const size =
      sizeName === "360p"
        ? "640x360"
        : sizeName === "480p"
        ? "800x480"
        : sizeName === "720p"
        ? "1280x720"
        : "1920x1080";
    const { storageKey } = job.attrs.data;
    console.log(`::CREATING::HLS::${sizeName}::`, storageKey);
    const outputFolder = `temp/${CHUNKS_FOLDER}/${storageKey}/${sizeName}`;
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true }); // this is gold
    }
    const hlsSegmentFilename = `${outputFolder}/${sizeName}_%03d.ts`;
    const playListPath = `${outputFolder}/${sizeName}.m3u8`;
    const { tempPath } = await fetchVideo(storageKey, Bucket);
    // <--
    if (!tempPath) {
      console.error("::ARCHIVO_NO_ENCONTRADO::", storageKey);
      onError?.(new Error("::FILE_FETCHED_ERROR::"));
      throw new Error("::FILE_FETCHED_ERROR::" + storageKey);
    }
    const command = Ffmpeg(tempPath, { timeout: 432000 })
      .size(size)
      .addOption("-profile:v", "baseline")
      .addOption("-level", "3.0")
      .addOption("-start_number", "0")
      .addOption("-hls_list_size", "0")
      .addOption("-hls_time", "6") // standard
      .addOption("-f", "hls")
      .addOption(`-hls_segment_filename ${hlsSegmentFilename}`);

    return await command
      .clone()
      .on("progress", function ({ frames, percent }) {
        console.info(
          `::PROCESSING_VIDEO::${storageKey}::${sizeName}::${percent?.toFixed(
            0
          )}%::`
        );
      })
      .on("error", function (err) {
        onError?.(err);
        console.error("ERROR_ON_MEDIA_PROCESSING: " + err.message);
      })
      .on("end", function () {
        console.info(`::VERSION_${sizeName}_CREATED::`);
        onFinish(outputFolder); // chunks/:storageKey
      })
      .save(playListPath);
  }); // defined

  await agenda.start();
  await agenda.schedule(when, "generate_hls_chunks", { storageKey });
};
