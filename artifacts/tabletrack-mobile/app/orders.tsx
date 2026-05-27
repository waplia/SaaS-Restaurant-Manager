// Top-level Orders route. Reuses the owner orders screen so non-owner
// roles (cashier, manager, etc.) can browse every ticket from their
// own More menu without being blocked by the (owner)/_layout AuthGate.
export { default } from "./(owner)/orders";
