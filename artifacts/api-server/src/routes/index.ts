import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tenantsRouter from "./tenants";
import restaurantsRouter from "./restaurants";
import usersRouter from "./users";
import tablesRouter from "./tables";
import menuRouter from "./menu";
import ordersRouter from "./orders";
import inventoryRouter from "./inventory";
import staffRouter from "./staff";
import customersRouter from "./customers";
import dashboardRouter from "./dashboard";
import publicRouter from "./public";
import seedRouter from "./seed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(seedRouter);
router.use(tenantsRouter);
router.use(restaurantsRouter);
router.use(usersRouter);
router.use(tablesRouter);
router.use(menuRouter);
router.use(ordersRouter);
router.use(inventoryRouter);
router.use(staffRouter);
router.use(customersRouter);
router.use(dashboardRouter);
router.use(publicRouter);

export default router;
