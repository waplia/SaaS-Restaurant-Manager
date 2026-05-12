import { Router } from "express";

const router = Router();

router.post("/__seed", async (_req, res) => {
  try {
    const { default: run } = await import("../seed.js");
    res.json({ status: "ok", message: "Seed completed" });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("already exists") || msg.includes("unique") || msg.includes("duplicate")) {
      res.json({ status: "ok", message: "Already seeded" });
    } else {
      res.status(500).json({ status: "error", message: msg });
    }
  }
});

export default router;
