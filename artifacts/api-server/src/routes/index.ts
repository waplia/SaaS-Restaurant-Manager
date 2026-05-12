import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tenantsRouter from "./tenants";
import restaurantsRouter from "./restaurants";
import usersRouter from "./users";
import rolesRouter from "./roles";
import tablesRouter from "./tables";
import menuRouter from "./menu";
import ordersRouter from "./orders";
import inventoryRouter from "./inventory";
import shiftsRouter from "./shifts";
import customersRouter from "./customers";
import dashboardRouter from "./dashboard";
import realtimeRouter from "./realtime";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tenantsRouter);
router.use(restaurantsRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(tablesRouter);
router.use(menuRouter);
router.use(ordersRouter);
router.use(inventoryRouter);
router.use(shiftsRouter);
router.use(customersRouter);
router.use(dashboardRouter);
router.use(realtimeRouter);
router.use(publicRouter);

export default router;
