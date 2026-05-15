import { eq } from "drizzle-orm";
import { db, appSettingsTable, type AppSettings, type PublicAppSettings } from "./db";

let cache: { settings: AppSettings; loadedAt: number } | null = null;
const TTL_MS = 15_000;

const SINGLETON_ID = 1;

export async function getAppSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) {
    return cache.settings;
  }
  let [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
  if (!row) {
    [row] = await db
      .insert(appSettingsTable)
      .values({ id: SINGLETON_ID })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, SINGLETON_ID));
    }
  }
  cache = { settings: row, loadedAt: Date.now() };
  return row;
}

export function invalidateAppSettingsCache(): void {
  cache = null;
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
  updatedBy: number | null,
): Promise<AppSettings> {
  await getAppSettings(true); // ensure row exists
  const [row] = await db
    .update(appSettingsTable)
    .set({ ...patch, updatedBy: updatedBy ?? null, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, SINGLETON_ID))
    .returning();
  invalidateAppSettingsCache();
  return row;
}

export function toPublicAppSettings(s: AppSettings): PublicAppSettings {
  return {
    appName: s.appName,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    supportWhatsapp: s.supportWhatsapp,
    companyAddress: s.companyAddress,
    defaultCurrency: s.defaultCurrency,
    defaultTimezone: s.defaultTimezone,
    dateFormat: s.dateFormat,
    timeFormat: s.timeFormat,
    footerText: s.footerText,
    socialLinks: s.socialLinks ?? {},
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    signupEnabled: s.signupEnabled,
    demoModeEnabled: s.demoModeEnabled,
    landingPageEnabled: s.landingPageEnabled,
  };
}
