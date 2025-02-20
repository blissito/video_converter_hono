import { EncodingSpeed, Version } from "../lib/encoder.js";
/**
 * Para 2 streams con baja y alta calidad [0, 4]
 * "[v:0]split=2[vtemp001][vtemp002];[vtemp001]scale=w=416:h=234[vout001];[vtemp002]scale=w=1280:h=720[vout002]"
 */
export function buildScalingString(streams: Version[]): string {
  // Splits the original stream in n streams
  let s = `[v:0]split=${streams.length}`;
  streams.forEach((q, i) => (s += `[vtemp${i}]`));
  s += ";";
  // escalads para cada tamaño
  streams.forEach((q, i) => {
    const [w, h] = mapQuality2Size(q);
    s += `[vtemp${i}]`; // Identificador de stream
    s += `scale=w=${w}:h=${h}`; // escala del stream
    s += `[vout${i}]`; // Identificador de salida
    if (i !== streams.length - 1) {
      s += ";"; // Separador entre instrucciones
    }
  });
  return s;
}

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
export const buildBitrateParameters = (versions: Version[]) => {
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
  });
  return args;
};

export const minMax = (rate: number, min: number, max: number): string => {
  const r = Math.min(max, Math.max(min, Math.floor(rate)));
};
