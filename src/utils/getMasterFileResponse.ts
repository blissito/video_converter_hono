export type VIDEO_SIZE = "360p" | "480p" | "720p" | "1080p" | "2040p";
const CHUNKS_HOST =
  "https://fly.storage.tigris.dev/video-converter-hono/chunks";
export const getMasterFileResponse = ({
  versions = [],
  storageKey,
}: {
  storageKey: string;
  versions?: VIDEO_SIZE[];
}) => {
  return new Response(getMasterFileString({ versions, storageKey }), {
    headers: {
      "content-type": "application/x-mpegURL",
    },
  });
};

export const getMasterFileString = ({
  versions,
  storageKey,
}: {
  storageKey: string;
  versions: VIDEO_SIZE[];
}) => {
  const HOST = `${CHUNKS_HOST}/${storageKey}`;
  let content = "#EXTM3U\n";
  if (versions.includes("360p")) {
    content += `#EXT-X-STREAM-INF:BANDWIDTH=375000,RESOLUTION=640x360\n${HOST}/360p.m3u8\n`;
  }
  if (versions.includes("480p")) {
    content += `#EXT-X-STREAM-INF:BANDWIDTH=750000,RESOLUTION=854x480\n${HOST}/480p.m3u8\n`;
  }
  if (versions.includes("720p")) {
    content += `#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n${HOST}/720p.m3u8\n`;
  }
  if (versions.includes("1080p")) {
    content += `#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080\n${HOST}/1080p.m3u8\n`;
  }
  return content;
};
