export const callWebHook = async ({
  eventName,
  error,
  webhook,
  storageKey,
}: {
  storageKey: string;
  eventName: "onEnd" | "onError" | "onStart" | "onDelete";
  error?: string;
  webhook: string;
}) => {
  if (!webhook) return;

  const r = await fetch(webhook, {
    method: "put",
    body: new URLSearchParams({
      error: error || "0",
      eventName,
      storageKey,
      token: process.env.CONVERTION_TOKEN as string,
    }),
  });
  console.info(`::WEBHOOK_RESPONSE::${r.ok}::${r.status}::${r.statusText}::`);
  return r;
};
