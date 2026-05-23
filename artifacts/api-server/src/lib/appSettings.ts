import { eq } from "drizzle-orm";
import { db, appSettingsTable, type AppSettings, type PublicAppSettings } from "./db";

/**
 * True when the platform has provider credentials wired up to send WhatsApp
 * messages without a per-restaurant override (used for auth OTPs sent before
 * a restaurant context exists, e.g. signup / login). Mirrors the check in
 * notificationCenter.getChannelCapabilities() and notifications.sendWhatsApp.
 */
export function isPlatformWhatsappConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

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
  // Defensive: if the platform doesn't have WhatsApp provider credentials,
  // never let the saved default channel be "whatsapp" — coerce to "sms" so
  // a stale UI state can't persist an unavailable channel.
  const normalisedPatch: Partial<AppSettings> =
    patch.authOtpDefaultChannel === "whatsapp" && !isPlatformWhatsappConfigured()
      ? { ...patch, authOtpDefaultChannel: "sms" }
      : patch;
  const [row] = await db
    .update(appSettingsTable)
    .set({ ...normalisedPatch, updatedBy: updatedBy ?? null, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, SINGLETON_ID))
    .returning();
  invalidateAppSettingsCache();
  return row;
}

export function toPublicAppSettings(s: AppSettings): PublicAppSettings & { whatsappEnabled: boolean } {
  return {
    whatsappEnabled: isPlatformWhatsappConfigured(),
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
    landingPageEnabled: s.landingPageEnabled,
    authPasswordLoginEnabled: s.authPasswordLoginEnabled,
    authMobileOtpLoginEnabled: s.authMobileOtpLoginEnabled,
    authEmailOtpLoginEnabled: s.authEmailOtpLoginEnabled,
    authTwoFactorEnabled: s.authTwoFactorEnabled,
    authSelfRegistrationRequireMobileOtp: s.authSelfRegistrationRequireMobileOtp,
    authOtpDefaultChannel: s.authOtpDefaultChannel,
    googleSignInEnabled: s.googleSignInEnabled,
    googleIosClientId: s.googleIosClientId ?? null,
    googleAndroidClientId: s.googleAndroidClientId ?? null,
  };
}
