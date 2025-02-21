import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Agenda } from '@hokify/agenda';
import { getPutFileUrl, getReadURL, listObjectsInFolder, deleteObjects } from 'react-hook-multipart';
import fs from 'fs';
import path from 'path';
import 'fluent-ffmpeg';
import { finished } from 'stream/promises';
import { Readable } from 'stream';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';
import { createRequire } from 'module';
import { spawn } from 'child_process';

const GUEST_MACHINE = {
    cpu_kind: "performance",
    cpus: 2,
    memory_mb: 4096,
}; // @todo dinamic , according to bitrate and vide size?
const MACHINES_API_URL = "https://api.machines.dev/v1/apps/video-converter-hono/machines";
// const INTERNAL_WORKER_URL = `http://worker.process.video-converter-hono.internal:3000`;
const startMachineCreationDetached = async (options) => {
    const { id: machineId, name: machineName } = await createMachine({
        image: await listMachinesAndFindImage(),
    });
    if (!machineId) {
        throw new Error("ERROR_ON_MACHINE_CREATION");
    }
    // DB connection
    const agenda = new Agenda({
        db: { address: process.env.DATABASE_URL },
    });
    agenda.define("start_machine", async () => {
        console.info("WAITING::FOR::MACHINE_TO_BE_REACHABLE::" + machineId);
        await waitForMachineToStart(machineId);
        // @todo the real work...
        const INTERNAL_HOST = `http://${machineId}.vm.video-converter-hono.internal:8000`;
        const url = new URL(INTERNAL_HOST);
        url.pathname = "/internal";
        url.searchParams.set("storageKey", options.storageKey);
        url.searchParams.set("sizeName", options.sizeName);
        url.searchParams.set("machineId", machineId);
        options.webhook && url.searchParams.set("webhook", options.webhook);
        options.Bucket && url.searchParams.set("Bucket", options.Bucket);
        const res = await fetch(url.toString(), { method: "POST" }); // delegating
        if (!res.ok) {
            await stopMachine(machineId);
            console.log("::MACHINE_STOPED::");
        }
        console.log("::DELEGATION_RESPONSE::", res.ok);
    });
    await agenda.start();
    await agenda.schedule("in 1 second", "start_machine");
    return { machineName, machineId };
};
// export const createMachineAndWaitToBeReady = async (
//   FLY_BEARER_TOKEN: string
// ) => {
//   console.log("REQUESTING::PERFORMANCE::MACHINE::");
//   const machineId = await createMachine({
//     image: await listMachinesAndFindImage(),
//     FLY_BEARER_TOKEN,
//   });
//   if (!machineId) {
//     console.error("ERROR_ON_MACHINE_CREACTION");
//     return null;
//   }
//   await waitForMachineToStart(machineId, FLY_BEARER_TOKEN);
//   return machineId;
// };
const createMachine = async ({ image, guest = GUEST_MACHINE, }) => {
    const init = {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            config: {
                image,
                guest,
                // guest: { cpu_kind: "performance", cpus: 1, memory_mb: 2048 },
                auto_destroy: true,
            },
        }),
    }; // @todo init?
    const response = await fetch(MACHINES_API_URL, init);
    if (!response.ok) {
        console.error("::ERROR_ON_CREATE_MACHINE_REQUEST::", response.statusText, response.status, await response.json());
        throw new Error(response.statusText);
    }
    const { name, id } = await response.json();
    console.log("::MAQUINA_CREADA::", name, id);
    return { name, id };
};
// @todo revisit
const stopMachine = async (machineId) => {
    if (!machineId)
        return;
    const init = {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}`,
        },
    };
    const response = await fetch(`${MACHINES_API_URL}/${machineId}/stop`, init);
    if (!response.ok) {
        console.error("La maquina no se detuvo", response.ok);
        return false;
    }
    console.log("MACHINE_STOPED");
    return true;
};
const waitForMachineToStart = async (id) => {
    const init = {
        method: "GET",
        headers: { Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}` },
    }; // @todo
    const response = await fetch(`${MACHINES_API_URL}/${id}/wait?state=started`, init);
    if (!response.ok)
        console.error("MACHINE_NOT_WAITED", response);
    return new Promise((res) => setTimeout(() => {
        console.log("::PERFORMANCE_MACHINE_READY::");
        res(response.ok);
    }, 2000));
};
const listMachinesAndFindImage = async () => {
    const init = {
        method: "GET",
        headers: { Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}` },
    }; // @todo
    const response = await fetch(MACHINES_API_URL, init);
    if (!response.ok) {
        throw new Error("::ERROR USING MACHINES_API_URL TO LIST::" +
            response.statusText +
            "::CHECK_YOUR::FLY_BEARER_TOKEN::ENV_VAR::");
    }
    const list = await response.json();
    if (list.length < 1) {
        throw new Error("No machines running, couldn`t find machine image");
    }
    return list[0].config.image; // watch any updates in here [needs a machine to be running]
};

// @ts-ignore
const uploadChunks = async ({ storageKey, tempFolder, cleanUp = true, onEnd, }) => {
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
        if (cleanUp)
            fs.rmSync(chunkPath, { recursive: true, force: true });
        return r;
    });
    await Promise.all(promises);
    console.log(`ALL_CHUNKS_UPLOADED ${chunkPaths.length} for: ${tempFolder}`);
    // update db stuff
    await onEnd?.();
};
const put = ({ file, contentType = "application/x-mpegURL", putURL, }) => fetch(putURL, {
    method: "PUT",
    body: file,
    headers: {
        "Content-Length": Buffer.byteLength(file).toString(),
        "Content-Type": contentType,
    },
});

dotenv.config();
// @todo: return cleanup!
const fetchVideo = async (storageKey, Bucket = "easybits-dev") => {
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
            error: new Error(String(response.status)),
        };
    }
    //  create temp directory
    const __dirname = path.dirname(tempPath);
    if (!fs.existsSync(__dirname)) {
        fs.mkdirSync(__dirname, { recursive: true });
    }
    // @todo try with a Buffer?
    const fileStream = fs.createWriteStream(tempPath); // la cajita (en disco) puede ser un Buffer 🧐
    await finished(Readable.fromWeb(response.body).pipe(fileStream));
    // console.info("FILE STATS: ", fs.statSync(tempPath));
    return {
        contentLength: response.headers.get("content-length") || "",
        contentType: response.headers.get("content-type") || "",
        ok: response.ok,
        tempPath,
        fileStream,
    };
};

/**
 * Para 2 streams con baja y alta calidad [0, 4]
 * "[v:0]split=2[vtemp001][vtemp002];[vtemp001]scale=w=416:h=234[vout001];[vtemp002]scale=w=1280:h=720[vout002]"
 */
function buildScalingString(versions) {
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
const mapQuality2Size = (q) => {
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
const mapQuality2Bitrate = (q) => {
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
const buildBitrateParameters = ({ versions, encodingSpeed, }) => {
    const args = [];
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
        args.push("-threads"); // gold 🥇
        args.push("2");
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
function buildStreamMap(versions) {
    return versions.map((q, i) => `v:${i},a:${i}`).join(" ");
    // return versions.map((_, i) => `v:${i},a:${i}`).join(" ");
}
const minMax = (rate, min, max) => {
    const r = Math.min(max, Math.max(min, Math.floor(rate)));
    return r.toString();
};
const deleteVideoSource = (path) => {
    fs.rmSync(path);
};

createRequire(import.meta.url);
var Version;
(function (Version) {
    Version["MOBILE"] = "360p";
    Version["SD"] = "480p";
    Version["HD"] = "720p";
    Version["FULL_HD"] = "1080p";
})(Version || (Version = {}));
var EncodingSpeed;
(function (EncodingSpeed) {
    EncodingSpeed["FAST"] = "superfast";
    EncodingSpeed["MEDIUM"] = "medium";
    EncodingSpeed["SLOW"] = "veryslow";
})(EncodingSpeed || (EncodingSpeed = {}));
var VideoStatus;
(function (VideoStatus) {
    VideoStatus[VideoStatus["PENDING"] = 0] = "PENDING";
    VideoStatus[VideoStatus["ENCODING"] = 1] = "ENCODING";
    VideoStatus[VideoStatus["DONE"] = 2] = "DONE";
    VideoStatus[VideoStatus["ERROR"] = 3] = "ERROR";
})(VideoStatus || (VideoStatus = {}));
/**
 * This should receive a fs path for a .mp4 or .mov video
 */
function convertMP4({ onEnd, onStart, videoSourcePath, storageKey, versions, segmentSize = 6, // secs
frameRate = 25, // 25 default @todo check for it before? ffmpeg proof?
encodingSpeed = EncodingSpeed.FAST, }) {
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
    const resultPayload = {
        hlspath: `${__dirname}`,
        versions,
    };
    onStart?.(resultPayload); // hook 🪝
    const video = videoSourcePath.replace(__dirname + "/", "");
    const child = spawn("ffmpeg", [
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
    ], { cwd: __dirname });
    // regular conf
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    return new Promise((res, rej) => {
        child.once("error", (err) => {
            resultPayload.error = err instanceof Error ? err.message : err;
            return rej(resultPayload);
        });
        child.once("exit", (code) => {
            if (code === 0) {
                deleteVideoSource(videoSourcePath); // @todo check if improve
                onEnd?.(resultPayload); // callback
                return res(resultPayload);
            }
            else {
                return rej(`Error code: ${code}`);
            }
        });
        child.on("data", (data) => {
            // console.info("::PROCESSING_VIDEO::", data);
            console.info("::PROCESSING_VIDEO::");
        });
    });
}

const transcodeDetached = async ({ Bucket, storageKey, onError, onEnd, onStart, }) => {
    const agenda = new Agenda({
        db: { address: process.env.DATABASE_URL },
    });
    // agenda schedule definition
    agenda.define("generate_hls_chunks", async (job) => {
        const { tempPath, ok, error } = await fetchVideo(storageKey, Bucket);
        if (!ok || !tempPath) {
            onError?.(error);
            throw error instanceof Error ? error : new Error(error);
        }
        convertMP4({
            // onStart,
            storageKey,
            versions: [Version.MOBILE, Version.SD, Version.HD, Version.FULL_HD],
            videoSourcePath: tempPath,
            onEnd: async ({ hlspath }) => {
                await uploadChunks({
                    storageKey,
                    tempFolder: hlspath,
                    onEnd: () => onEnd?.(hlspath),
                });
            },
        });
    }); // define
    await agenda.start();
    onStart?.(); // @hook 🪝
    await agenda.schedule("in 1 sec", "generate_hls_chunks", { storageKey });
};

const CHUNKS_HOST$1 = "https://fly.storage.tigris.dev/video-converter-hono/chunks";
const getMasterFileString = ({ versions, storageKey, }) => {
    const HOST = `${CHUNKS_HOST$1}/${storageKey}`;
    // let content = "#EXTM3U\n";
    let content = ""; // no first extm3u tag
    if (versions.includes("360p")) {
        content += `#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=640x360\n${HOST}/360p.m3u8\n`;
    }
    if (versions.includes("480p")) {
        content += `#EXT-X-STREAM-INF:BANDWIDTH=240000,RESOLUTION=854x480\n${HOST}/480p.m3u8\n`;
    }
    if (versions.includes("720p")) {
        content += `#EXT-X-STREAM-INF:BANDWIDTH=440000,RESOLUTION=1280x720\n${HOST}/720p.m3u8\n`;
    }
    if (versions.includes("1080p")) {
        content += `#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=1920x1080\n${HOST}/1080p.m3u8\n`;
    }
    return content;
    // badnwidths: https://developer.apple.com/documentation/http-live-streaming/creating-a-multivariant-playlist
};

const callWebHook = async ({ eventName, error, webhook, storageKey, }) => {
    if (!webhook)
        return;
    const r = await fetch(webhook, {
        method: "put",
        body: new URLSearchParams({
            error: error || "0",
            eventName,
            storageKey,
            token: process.env.CONVERTION_TOKEN,
        }),
    });
    console.info(`::WEBHOOK_RESPONSE::${r.ok}::${r.status}::${r.statusText}::`);
    return r;
};

// @ts-ignore
const handleDeleteAllChunks = async (c) => {
    const AuthToken = c.req.header("Authorization");
    // @todo correct auth middleware?
    if (AuthToken !== "Bearer PerroTOken")
        return c.text("Forbidden", 403);
    const storageKey = c.req.query("storageKey");
    const webhook = c.req.query("webhook");
    if (!storageKey)
        return c.text("No storageKey", 400);
    const path = `chunks/${storageKey}/`;
    const list = await listObjectsInFolder(path);
    if (list.KeyCount < 1) {
        return c.text("Empty Folder", 404);
    }
    console.info("::ABOUT_TO_DELETE_OBJECTS::", list.KeyCount);
    const resul = await deleteObjects(undefined, list.Contents);
    console.info("::OBJECTS_DELETED::", resul.Deleted.length);
    webhook &&
        (await callWebHook({
            webhook,
            eventName: "onDelete",
            storageKey,
        }));
    return c.text("Working");
};

// @todo bearer token generation on a dashboard
const CONVERTION_TOKEN = process.env.CONVERTION_TOKEN;
const CHUNKS_HOST = "https://fly.storage.tigris.dev/video-converter-hono/chunks";
const app = new Hono();
// CORS should be called before the route
app.use("*", cors({
    origin: "*",
}));
app.get("/", (c) => {
    return c.text("Hello Blissmo");
});
// 2. receive internal request
app.post("/internal", async (c) => {
    const url = new URL(c.req.url);
    const storageKey = url.searchParams.get("storageKey");
    const machineId = url.searchParams.get("machineId");
    const webhook = url.searchParams.get("webhook");
    const Bucket = url.searchParams.get("Bucket");
    if (!storageKey || !machineId)
        return c.text("Bad Request", 400);
    const callWebHook = async (eventName, error) => {
        if (!webhook)
            return;
        const r = await fetch(webhook, {
            method: "put",
            body: new URLSearchParams({
                error: error || "0",
                eventName,
                storageKey,
                token: CONVERTION_TOKEN,
                masterPlaylistContent: getMasterFileString({
                    versions: ["360p", "480p", "720p", "1080p"],
                    storageKey,
                }),
                masterPlaylistURL: `${CHUNKS_HOST}/${storageKey}/main.m3u8`,
            }),
        });
        console.info(`::WEBHOOK_RESPONSE::${r.ok}::${r.status}::${r.statusText}::`);
        return r;
    };
    //  detached work...
    transcodeDetached({
        Bucket, // @todo revisit used in fetchVideo
        storageKey,
        onEnd: async (playListPath) => {
            uploadChunks({
                storageKey,
                tempFolder: playListPath,
                async onEnd() {
                    // @todo generate master playlist and upload it?
                    await callWebHook("onEnd");
                    await stopMachine(machineId);
                },
            });
        },
        async onError(error) {
            await callWebHook("onError", (error instanceof Error ? error : new Error(String(error))).message);
            await stopMachine(machineId);
        },
        async onStart() {
            await callWebHook("onStart");
        },
    });
    // stop machine?
    return c.text(`TRANSCODING_STARTED_FOR_${storageKey}`);
});
// 1. create the machine and wait for it to be ready
app.post("/start", async (c) => {
    const body = await c.req.json();
    const AuthToken = c.req.header("Authorization");
    // @todo correct auth
    if (AuthToken !== "Bearer PerroTOken")
        return c.text("Forbidden", 403);
    const { machineId, machineName } = await startMachineCreationDetached(body);
    if (!machineId) {
        return c.text("Error on machine creation", {
            status: 500,
        });
    }
    return c.json({
        playlistURL: `https://fly.storage.tigris.dev/video-converter-hono/chunks/${body.storageKey}/main.m3u8`,
        machineId,
        machineName,
        ...body,
    });
});
app.post("/test", async (c) => {
    const storageKey = await c.req.query("storageKey");
    if (!storageKey)
        return c.text("Bad Request", 400);
    const response = await fetch("https://easybits.cloud/api/v1/conversion_webhook", {
        method: "PUT",
        body: new URLSearchParams({
            storageKey,
            token: "pelusina69",
        }),
    });
    return c.json(response);
});
app.post("/multiple_test", async (c) => {
    const storageKey = c.req.query("storageKey");
    const bucket = c.req.query("bucket");
    if (!storageKey || !bucket)
        return c.text("Bad Request::" + storageKey + "::" + bucket, 400);
    const { tempPath, ok, error } = await fetchVideo(storageKey, bucket);
    if (!ok || !tempPath)
        return c.text("::Error on fetching video::" + error?.message, 500);
    // needs to be in this order to upload correctly...
    const versions = [Version.MOBILE, Version.SD, Version.HD, Version.FULL_HD];
    convertMP4({
        storageKey,
        versions,
        videoSourcePath: tempPath,
        onEnd: async ({ hlspath }) => {
            console.log("WTF?::HLSPATH", hlspath);
            await uploadChunks({
                storageKey,
                tempFolder: hlspath,
                onEnd: () => {
                    // update db / webhook
                    console.log("Webhook, We'r all set!");
                },
            });
        },
    });
    return c.json({
        status: "working",
        storageKey,
        versions,
    });
});
app.delete("/delete_all", handleDeleteAllChunks);
const port = 8000;
console.log(`Server is running on http://localhost:${port}`);
serve({
    fetch: app.fetch,
    port,
});
