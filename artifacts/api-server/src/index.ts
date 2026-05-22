import http from "http";
import app from "./app";
import { initSocketIO } from "./lib/socketio";
import { startScheduler } from "./lib/scheduler";
import { startBroadcastScheduler, seedDefaultTemplates } from "./lib/notificationCenter";
import { seedDefaultAiCreditRules } from "./lib/aiCreditRulesSeeder";
import { seedStockFoodImages } from "./lib/stockFoodImages";
import { seedDefaultSupportCategories } from "./lib/supportCategoriesSeeder";
import { seedDefaultFestivals } from "./routes/advanced-growth";
import { seedAddonCatalogue } from "./lib/addons";
import { seedDefaultManualMethods } from "./lib/paymentSettings";
import { seedDefaultEmailTemplates } from "./lib/emailSender";
import { seedDefaultWhatsAppTemplates } from "./lib/whatsappTemplateSeeder";
import { seedDefaultSmsTemplates } from "./lib/smsTemplateSeeder";
import { resumePersistedSessions as resumeWhatsAppSessions } from "./lib/whatsappWebQr";
import { logger } from "./lib/logger";
import { backfillDefaultKitchens } from "./lib/kitchenRouting";
import { backfillCustomerCrm } from "./lib/customerBackfill";
import { getAppSettings } from "./lib/appSettings";
import { ensureSearchIndexes } from "./lib/searchIndexes";
import { runBootstrapPasswordReset } from "./lib/bootstrapReset";
import { backfillAllRestaurants as backfillPaymentConfig } from "./lib/paymentConfig";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);
initSocketIO(httpServer);
startScheduler();
startBroadcastScheduler();
seedDefaultTemplates().catch(err => console.error("Failed to seed default templates", err));
seedDefaultAiCreditRules().catch(err => console.error("Failed to seed default AI credit rules", err));
seedStockFoodImages().catch(err => console.error("Failed to seed stock food images", err));
seedDefaultSupportCategories().catch(err => console.error("Failed to seed default support categories", err));
seedDefaultFestivals().catch(err => console.error("Failed to seed default festivals", err));
seedAddonCatalogue().catch(err => console.error("Failed to seed add-on catalogue", err));
seedDefaultManualMethods().catch(err => console.error("Failed to seed default manual payment methods", err));
seedDefaultEmailTemplates().catch(err => console.error("Failed to seed default email templates", err));
seedDefaultWhatsAppTemplates()
  .then(r => logger.info({ inserted: r.inserted, skipped: r.skipped }, "WhatsApp template seeder completed"))
  .catch(err => console.error("Failed to seed default WhatsApp templates", err));
seedDefaultSmsTemplates()
  .then(r => logger.info({ inserted: r.inserted, skipped: r.skipped }, "SMS template seeder completed"))
  .catch(err => console.error("Failed to seed default SMS templates", err));
// Re-establish Baileys (web QR) sessions that were "connected" before the
// last restart. Without this, every server restart silently kills outbound
// WhatsApp until staff manually re-scans the QR — every order-placed /
// order-ready dispatch logs as `blocked: no_session` instead.
resumeWhatsAppSessions().catch(err => console.error("Failed to resume WhatsApp sessions", err));
runBootstrapPasswordReset().catch(err => console.error("Bootstrap password reset failed", err));

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error({ port }, "Port already in use — likely an orphan from a previous run. Exiting so the workflow can restart cleanly.");
  } else {
    logger.error({ err }, "HTTP server error");
  }
  process.exit(1);
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");

  backfillDefaultKitchens()
    .then(() => logger.info("Default kitchens backfill complete"))
    .catch((e) => logger.error({ err: e }, "Default kitchens backfill failed"));

  backfillCustomerCrm()
    .then((r) => logger.info(r, "Customer CRM backfill complete"))
    .catch((e) => logger.error({ err: e }, "Customer CRM backfill failed"));

  getAppSettings(true)
    .then(() => logger.info("App settings singleton ensured"))
    .catch((e) => logger.error({ err: e }, "App settings singleton seed failed"));

  ensureSearchIndexes()
    .catch((e) => logger.error({ err: e }, "Failed to ensure tenant search indexes"));

  // Task #587 — Eagerly seed payment-config rows for every restaurant so
  // historical reporting + analytics queries can rely on the new tables
  // being populated for all tenants (not just those who visit the admin UI).
  backfillPaymentConfig()
    .then((r) => logger.info(r, "Payment-config backfill complete"))
    .catch((e) => logger.error({ err: e }, "Payment-config backfill failed"));
});

function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal — closing HTTP server");
  const force = setTimeout(() => {
    logger.warn("Force-exiting after 5s graceful-shutdown timeout");
    process.exit(0);
  }, 5000);
  force.unref();
  httpServer.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
