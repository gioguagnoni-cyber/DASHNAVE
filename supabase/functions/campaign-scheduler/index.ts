import { createHandler } from "./handler.mjs";

// Custom auth in handler: Cron secret OR a verified, account-authorized user.
Deno.serve(createHandler(Deno.env.toObject()));
