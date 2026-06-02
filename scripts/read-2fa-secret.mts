import { read2FASecretFromQrFile } from "../src/lib/read-2fa-secret.js";

const data = await read2FASecretFromQrFile();

console.log("Secret:", data.secret);
console.log("Issuer:", data.issuer);
console.log("Label:", data.label);
console.log("Type:", data.type);
console.log("Algorithm:", data.algorithm);
console.log("Digits:", data.digits);
console.log("Period:", data.period);
