/** SMTP readiness test: `npm run smtp:test -- you@your-domain.sr` (uses the SMTP_* variables of the environment). */
import { testEmailDelivery } from "../src/integrations/email";

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error("Usage: npm run smtp:test -- <recipient e-mail address>");
  process.exit(2);
}
testEmailDelivery(to).then((r) => {
  console.log(r.ok ? "✓ SMTP verified and test message sent." : `✗ ${r.code}`);
  process.exit(r.ok ? 0 : 1);
});
