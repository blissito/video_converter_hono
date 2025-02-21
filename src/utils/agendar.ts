import { Agenda, Job } from "@hokify/agenda";

export const agendar = async <T extends Job<any>>(
  cb: (data: Job<any>) => void,
  data: T
) => {
  const agenda = new Agenda({
    db: { address: process.env.DATABASE_URL as string },
  });
  agenda.define("generic_child_process", async (job) => {
    cb(job);
  });
  await agenda.start();
  await agenda.schedule("in 1 sec", "generic_child_process", data);
};
