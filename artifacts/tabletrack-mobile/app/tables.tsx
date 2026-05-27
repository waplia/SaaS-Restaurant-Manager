// Top-level Tables (floor view) route. Reuses the owner tables screen
// so cashiers and other non-owner roles can open the floor view from
// their More menu without hitting the (owner)/_layout AuthGate.
export { default } from "./(owner)/tables";
