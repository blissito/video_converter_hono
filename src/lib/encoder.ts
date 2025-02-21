import { createRequire } from "module";
import { spawn } from "child_process";
// @ts-ignore
import fs from "fs";

import {
  buildBitrateParameters,
  buildRenditionParams,
  buildScalingString,
  buildStreamMap,
  deleteVideoSource,
  minMax,
} from "../utils/encoder_utils.js";
import path from "path";
const require = createRequire(import.meta.url);

export enum Version {
  MOBILE = "360p",
  SD = "480p",
  HD = "720p",
  FULL_HD = "1080p",
}

export enum EncodingSpeed { // -preset
  FAST = "superfast",
  MEDIUM = "medium",
  SLOW = "veryslow",
}

export enum VideoStatus {
  PENDING = 0,
  ENCODING = 1,
  DONE = 2,
  ERROR = 3,
}

export type ConvertMP4Input = {
  videoSourcePath: string;
  storageKey: string; // no "/" should be present ?
  versions: Version[];
  encodingSpeed?: EncodingSpeed;
  frameRate?: number;
  segmentSize?: number;
  onEnd?: (arg0: ConvertMP4Return) => void;
};
export type ConvertMP4Return =
  | {
      hlspath: string;
      storageKey?: string;
      versions: Version[];
      error?: string | unknown;
    }
  | {
      hlspath?: string;
      error?: string | unknown;
    };
/**
 * This should receive a fs path for a .mp4 or .mov video
 */
export function convertMP4({
  onEnd,
  videoSourcePath,
  storageKey,
  versions,
  segmentSize = 6, // secs
  frameRate = 25, // 25 default @todo check for it before? ffmpeg proof?
  encodingSpeed = EncodingSpeed.FAST,
}: ConvertMP4Input): Promise<ConvertMP4Return> {
  // create directories
  console.info("::TRANSCODING::", storageKey);
  // params validation
  if (versions.length < 1)
    return Promise.reject({ error: "No versions received" });

  // const ffmpegExec = path.join(path.dirname(require.resolve("ffmpeg-static")));
  //  create temp directory
  const __dirname = path.dirname(videoSourcePath);
  if (!fs.existsSync(__dirname)) {
    fs.mkdirSync(__dirname, { recursive: true });
  }
  const video = videoSourcePath.replace(__dirname + "/", "");
  const child = spawn(
    "ffmpeg",
    [
      "-i",
      `${video}`,
      // usamos filter_complex para crear varios streams con diferentes resoluciones
      "-filter_complex",
      buildScalingString(versions),
      ...buildBitrateParameters({ versions, encodingSpeed, frameRate }),
      ...versions.map(() => ["-map", "a:0?"]).flat(), // @todo if no audio it fails
      "-f",
      "hls",
      "-hls_time",
      minMax(segmentSize, 2, 8),
      "-hls_playlist_type",
      "vod",
      // "event",
      "-hls_flags",
      "independent_segments",
      "-master_pl_name",
      `main.m3u8`, // Esto reutiliza el directorio de playlist.m3u8
      "-hls_segment_filename",
      `stream_%v_%04d.ts`,
      "-strftime_mkdir",
      "1",
      "-var_stream_map",
      buildStreamMap(versions), // the most important!
      // Playlists names @todo cambiar por nombres
      `playlist_%v.m3u8`,
    ],
    { cwd: __dirname }
  );

  // regular conf
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  const resultPayload: ConvertMP4Return = {
    hlspath: `${__dirname}`,
    versions,
  };
  return new Promise((res, rej) => {
    child.once("error", (err: unknown) => {
      resultPayload.error = err instanceof Error ? err.message : err;
      return res(resultPayload);
    });
    child.once("exit", (code: number) => {
      if (code === 0) {
        deleteVideoSource(videoSourcePath); // @todo check if improve
        onEnd?.(resultPayload); // callback
        return res(resultPayload);
      } else {
        return rej(`Error code: ${code}`);
      }
    });
    child.on("data", (data: unknown) => {
      // console.info("::PROCESSING_VIDEO::", data);
      console.info("::PROCESSING_VIDEO::");
    });
  });
}
