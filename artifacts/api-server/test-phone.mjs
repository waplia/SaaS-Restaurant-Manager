import { parsePhone, normalizePhone as norm } from "@workspace/phone-utils";
function run(countryCode, phone) {
  const ccDigits = countryCode.replace(/\D/g, "");
  let localDigits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (ccDigits && localDigits.startsWith(ccDigits)) {
    localDigits = localDigits.slice(ccDigits.length).replace(/^0+/, "");
  }
  const parsed = parsePhone(`+${ccDigits}${localDigits}`, undefined);
  const finalCc = (parsed.country.code || ccDigits).replace(/\D/g, "");
  let finalNational = parsed.national.replace(/\D/g, "");
  if (finalCc && finalNational.startsWith(finalCc)) {
    finalNational = finalNational.slice(finalCc.length).replace(/^0+/, "");
  }
  const n = norm(`+${finalCc}${finalNational}`);
  // strip space (n is "91 8306020200")
  return "+" + n.replace(/\s+/g, "");
}
const cases = [
  ["+91","8306020200"],
  ["+91","918306020200"],
  ["+91","08306020200"],
  ["+91","919183060202"],     // doubled with different number
  ["+91","91918306020200"],   // triply re-typed
  ["+9183","06020200"],       // mobile greedy bug shape
  ["+1","5551234567"],
];
for (const [cc,p] of cases) console.log(`${cc} + ${p} -> ${run(cc,p)}`);
