import { EncodingSpeed, Version } from "../lib/encoder.js";
import fs from "fs";
/**
 * Para 2 streams con baja y alta calidad [0, 4]
 * "[v:0]split=2[vtemp001][vtemp002];[vtemp001]scale=w=416:h=234[vout001];[vtemp002]scale=w=1280:h=720[vout002]"
 */
export function buildScalingString(versions: Version[]): string {
  // Splits the original stream in n streams
  let s = `[v:0]split=${versions.length}`;
  versions.forEach((_, i) => (s += `[vtemp${i}]`));
  s += ";"; // [0:v]split=3[vtemp0][vtemp1][vtemp2];
  // escalads para cada tamaño (usando q en vez de i)
  versions.forEach((q, i) => {
    const [w, h] = mapQuality2Size(q);
    s += `[vtemp${i}]`; // Identificador de stream
    s += `scale=w=${w}:h=${h}`; // escala del stream
    // s += i === 3 ? `copy` : `scale=w=${w}:h=${h}`;
    s += `[vout${i}]`; // Identificador de salida (interno)
    if (i !== versions.length - 1) {
      s += ";"; // Separador entre instrucciones
    }
  });
  return s;
}

export const buildRenditionParams = ({
  versions,
  segmentSize,
  storageKey,
}: {
  versions: Version[];
  segmentSize: number;
  storageKey: string;
}) => {
  const formats: string[] = [];
  versions.forEach((v) => {
    const [w, h] = mapQuality2Size(v);
    const [bitrate, maxBitrare, bufsize] = mapQuality2Bitrate(v);
    formats.push(`-vf`);
    formats.push(`scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease`);
    formats.push("-acodec");
    formats.push("copy");
    formats.push("-c:v");
    formats.push("libx264");
    formats.push("-sc_threshold");
    formats.push("0");
    formats.push("-g");
    formats.push("0");
    formats.push("-hls_time");
    formats.push(`${minMax(segmentSize, 2, 8)}`);
    formats.push("-hls_playlist_type");
    formats.push("vod");
    formats.push("-b:v");
    formats.push(`${bitrate}`);
    formats.push(`-maxrate`);
    formats.push(`${maxBitrare}`);
    formats.push(`-bufsize`);
    formats.push(`${bufsize}`);
    formats.push("-hls_flags");
    formats.push("independent_segments");
    formats.push(`-hls_segment_filename`);
    formats.push(`temp/${storageKey}/${v}_%03d.ts`);
    // formats.push(`-strftime_mkdir`);
    // formats.push("1");
    formats.push(`temp/${storageKey}/${v}.m3u8`);
  });
  return formats;
};

const mapQuality2Size = (q: Version) => {
  switch (q) {
    case Version.MOBILE:
      return ["640", "360"];
    case Version.SD:
      return ["800", "480"];
    case Version.HD:
      return ["1280", "720"];
    case Version.FULL_HD:
      return ["1920", "1080"];
  }
};
/**
 *
 * el max es bitrate `10%
 * el bufSize es bitrate * 150%
 * @todo esto se puede ajustar mejor?
 */
const mapQuality2Bitrate = (q: Version) => {
  switch (q) {
    case Version.MOBILE:
      return ["365k", "400k", "600k"];
    case Version.SD:
      return ["730k", "800k", "1100k"];
    case Version.HD:
      return ["3000k", "3300k", "4500k"];
    case Version.FULL_HD:
      return ["6000k", "6600k", "9000k"];
  }
};

/**
 *
 * @param versions ejem: Para 2 streams
 *  ['-map', '[vout001]', '-c:v:0', 'libx264', '-b:v:0',  '145k', '-maxrate:v:0',  '160k', '-bufsize:v:0',  '800k',
 *   '-map', '[vout002]', '-c:v:1', 'libx264', '-b:v:1', '3000k', '-maxrate:v:1', '3300k', '-bufsize:v:1', '4000k']
 * @todo Change index for version
 */
export const buildBitrateParameters = ({
  versions,
  encodingSpeed,
  frameRate,
}: {
  versions: Version[];
  encodingSpeed: string;
  frameRate: number;
}) => {
  const args: string[] = [];
  versions.forEach((q, i) => {
    const [bitrate, maxBitrare, bufsize] = mapQuality2Bitrate(q);
    // Identificador
    args.push("-map");
    args.push(`[vout${i}]`);
    // El mismo códec para todos los streams
    args.push(`-c:v:${i}`);
    args.push("libx264");
    // Definimos el bitrate para cada stream
    args.push(`-b:v:${i}`);
    args.push(bitrate);
    // ajustamos el máximo
    args.push(`-maxrate:v:${i}`);
    args.push(maxBitrare);
    // asignamos el buffer
    args.push(`-bufsize:v:${i}`);
    args.push(bufsize);
    // preset
    args.push("-preset");
    args.push(encodingSpeed);
    args.push("-g");
    args.push("48");
    args.push("-sc_threshold");
    args.push("0");
    args.push("-keyint_min");
    args.push("48");
  });

  // @todo check if we can do this just once
  // versions.forEach((_, i) => {
  //   args.push("-map");
  //   args.push("a:0");
  //   args.push(`-c:a:${i}`);
  //   args.push(`aac`);
  //   args.push(`-b:a:${i}`);
  //   args.push(`96k`);
  //   args.push(`-ac`);
  //   args.push(`2`);
  // });

  return args;
};

export function buildStreamMap(versions: Version[]): string {
  return versions.map((q, i) => `v:${i},a:${i}`).join(" ");
  // return versions.map((_, i) => `v:${i},a:${i}`).join(" ");
}

export const minMax = (rate: number, min: number, max: number): string => {
  const r = Math.min(max, Math.max(min, Math.floor(rate)));
  return r.toString();
};

export const deleteVideoSource = (path: string) => {
  fs.rmSync(path);
};
