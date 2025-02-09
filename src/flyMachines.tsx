import { Agenda } from "@hokify/agenda";

export type VIDEO_SIZE = "360p" | "480p" | "720p" | "1080p" | "2040p";

const MACHINES_API_URL =
  "https://api.machines.dev/v1/apps/video-converter-hono/machines";
// const INTERNAL_WORKER_URL = `http://worker.process.video-converter-hono.internal:3000`;

export const startMachineCreationDetached = async (options: {
  storageKey: string;
  sizeName: string;
  webhook?: string;
}) => {
  const machineId = await createMachine({
    image: await listMachinesAndFindImage(),
  });
  if (!machineId) {
    throw new Error("ERROR_ON_MACHINE_CREATION");
  }

  // DB connection
  const agenda = new Agenda({
    db: { address: process.env.DATABASE_URL as string },
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
    const res = await fetch(url.toString(), { method: "POST" }); // delegating
    if (!res.ok) {
      await stopMachine(machineId);
      console.log("::MACHINE_STOPED::");
    }
    console.log("::DELEGATION_RESPONSE::", res.ok);
  });
  await agenda.start();
  await agenda.schedule("in 1 second", "start_machine");

  return machineId;
};

export const createMachineAndWaitToBeReady = async (
  FLY_BEARER_TOKEN: string
) => {
  console.log("REQUESTING::PERFORMANCE::MACHINE::");
  const machineId = await createMachine({
    image: await listMachinesAndFindImage(FLY_BEARER_TOKEN),
    FLY_BEARER_TOKEN,
  });
  if (!machineId) {
    console.error("ERROR_ON_MACHINE_CREACTION");
    return null;
  }

  await waitForMachineToStart(machineId, FLY_BEARER_TOKEN);
  return machineId;
};

const createMachine = async ({
  image,
  guest = { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
}: {
  guest?: {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  };
  image: string;
}) => {
  const init: RequestInit = {
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
    console.error(
      "::ERROR_ON_CREATE_MACHINE_REQUEST::",
      response.statusText,
      response.status,
      await response.json()
    );
    throw new Error(response.statusText);
  }
  const { name, id } = await response.json();
  console.log("::MAQUINA_CREADA::", name, id);
  return id;
};
// @todo revisit
export const stopMachine = async (machineId: string) => {
  if (!machineId) return;

  const init: RequestInit = {
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

const waitForMachineToStart = async (id: string) => {
  const init: RequestInit = {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}` },
  }; // @todo
  const response = await fetch(
    `${MACHINES_API_URL}/${id}/wait?state=started`,
    init
  );
  if (!response.ok) console.error("MACHINE_NOT_WAITED", response);

  return new Promise((res) =>
    setTimeout(() => {
      console.log("::PERFORMANCE_MACHINE_READY::");
      res(response.ok);
    }, 2000)
  );
};

const listMachinesAndFindImage = async () => {
  const init: RequestInit = {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.FLY_BEARER_TOKEN}` },
  }; // @todo
  const response = await fetch(MACHINES_API_URL, init);
  if (!response.ok) {
    throw new Error(
      "::ERROR USING MACHINES_API_URL TO LIST::" +
        response.statusText +
        "::CHECK_YOUR::FLY_BEARER_TOKEN::ENV_VAR::"
    );
  }
  const list = await response.json();
  return list[0].config.image; // watch any updates in here [needs a machine to be running]
};
