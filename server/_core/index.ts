import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { webhookRouter } from "../webhooks";
import { attachMediaStreamHandler } from "../twilio";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Configure body parser with larger size limit
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Webhook routes (Facebook, Twilio status, TwiML, phone provisioning)
  app.use("/api/webhooks", webhookRouter);

  // TwiML voice endpoint — also accessible at /api/twiml/voice
  // (Twilio calls this when the outbound call is answered)
  // Helper to get the correct public stream URL for Twilio
  // IMPORTANT: The production server runs behind a Cloudflare proxy that strips
  // x-forwarded-host, so req.headers.host returns the internal Cloud Run URL.
  // We must use the known published domain directly.
  const PUBLISHED_DOMAIN = "wrenchai-bokbst2i.manus.space";
  function getStreamUrl(req: express.Request): string {
    // In development, use the request host (dev preview URL supports WebSockets)
    if (process.env.NODE_ENV === "development") {
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || PUBLISHED_DOMAIN;
      const wsProtocol = String(protocol) === "https" ? "wss" : "ws";
      return `${wsProtocol}://${host}/api/twiml/stream`;
    }
    // In production, always use the published domain — the proxy strips forwarded headers
    return `wss://${PUBLISHED_DOMAIN}/api/twiml/stream`;
  }

  function buildTwiMLResponse(req: express.Request, res: express.Response) {
    const streamUrl = getStreamUrl(req);
    console.log(`[TwiML] Stream URL: ${streamUrl}`);
    const q = req.query as Record<string, string>;
    const { buildTwiML } = require("../twilio");
    const twiml = buildTwiML(streamUrl, {
      leadId: q.leadId,
      leadName: q.leadName,
      leadEmail: q.leadEmail,
      leadPhone: q.leadPhone,
      agentName: q.agentName,
      extraContext: q.extraContext,
    });
    console.log(`[TwiML] Generated TwiML with params: leadId=${q.leadId}, leadName=${q.leadName}, agentName=${q.agentName}`);
    res.set("Content-Type", "text/xml");
    res.send(twiml);
  }

  app.post("/api/twiml/voice", buildTwiMLResponse);
  app.get("/api/twiml/voice", buildTwiMLResponse);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Attach Twilio Media Stream WebSocket handler AFTER server starts
    // This handles the real-time audio bridge between Twilio and Gemini Live
    attachMediaStreamHandler(server);
  });
}

startServer().catch(console.error);
