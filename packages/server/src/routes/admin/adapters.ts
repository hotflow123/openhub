import { Hono } from "hono";
import { listProviderAdapterRegistrations, publicAdapterRegistration } from "../../engine/adapter-manifest";
import { withAdminAuth } from "./_with-auth";

const adapters = new Hono();
withAdminAuth(adapters);

adapters.get("/adapters", (c) => {
  return c.json({ data: listProviderAdapterRegistrations().map(publicAdapterRegistration) });
});

export default adapters;
