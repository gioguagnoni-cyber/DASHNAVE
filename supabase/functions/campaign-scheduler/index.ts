import { createHandler } from "./handler.mjs";

// Authentication is enforced inside the handler for both users and the cron worker.
Deno.serve(createHandler(Deno.env.toObject()));
