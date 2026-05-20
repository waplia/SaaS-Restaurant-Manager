import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiErrorLogger, exceptionHandler, installProcessExceptionHandlers } from "./middleware/systemLogging";
import { securityHeaders } from "./middleware/securityHeaders";

installProcessExceptionHandlers();

const app: Express = express();
// Default: do NOT trust X-Forwarded-* from any client. `req.ip` resolves to
// the socket address. This is the only safe default: numeric hop counts
// (`trust proxy = 1`) trust the IP one back in XFF *regardless of who the
// immediate connection is*, which means any attacker connecting directly
// can spoof the header and rotate our rate-limit key.
//
// Operators MUST set TRUST_PROXY in production to the CIDR of the known
// upstream proxy/edge so `req.ip` reflects the real client. Examples:
//   TRUST_PROXY=10.0.0.0/8           (private LB)
//   TRUST_PROXY=loopback             (only requests from 127.0.0.1)
//   TRUST_PROXY=1                    (last hop — ONLY if a trusted edge always overwrites XFF)
//   TRUST_PROXY=false                (explicit opt-out)
const trustProxyEnv = process.env.TRUST_PROXY?.trim();
if (trustProxyEnv) {
  if (trustProxyEnv === "false") {
    app.set("trust proxy", false);
  } else if (/^\d+$/.test(trustProxyEnv)) {
    app.set("trust proxy", Number(trustProxyEnv));
  } else {
    app.set("trust proxy", trustProxyEnv);
  }
} else {
  app.set("trust proxy", false);
}
app.disable("x-powered-by");
app.use(apiErrorLogger);
app.use(securityHeaders);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: in production, restrict to the configured app origins; in dev, allow
// requests with no Origin (curl, mobile apps, same-host) and any localhost.
// `credentials: true` keeps cookie/refresh-token flows working from the SPA.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.PUBLIC_APP_URL ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // non-browser clients
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalized)) return callback(null, true);
    if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(normalized)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== "production" && /\.replit\.(dev|app|co)$/.test(new URL(origin).hostname)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  maxAge: 600,
};
app.use(cors(corsOptions));

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use("/api/cashfree/webhook", express.raw({ type: "application/json" }));
app.use("/api/razorpay/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(exceptionHandler);

export default app;
