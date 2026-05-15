import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiErrorLogger, exceptionHandler, installProcessExceptionHandlers } from "./middleware/systemLogging";

installProcessExceptionHandlers();

const app: Express = express();
app.use(apiErrorLogger);

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
app.use(cors());

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use("/api/cashfree/webhook", express.raw({ type: "application/json" }));
app.use("/api/razorpay/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(exceptionHandler);

export default app;
