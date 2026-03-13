#!/usr/bin/env node

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");

const CHARGEDESK_API_KEY = process.env.CHARGEDESK_API_KEY;
if (!CHARGEDESK_API_KEY) {
  console.error("Error: CHARGEDESK_API_KEY environment variable is required");
  process.exit(1);
}

const chargedesk = axios.create({
  baseURL: "https://api.chargedesk.com/v1",
  auth: { username: CHARGEDESK_API_KEY, password: "" },
});

async function main() {
  const count = parseInt(process.argv[2], 10) || 50;
  console.log(`Fetching ${count} charges from Chargedesk...\n`);

  const { data } = await chargedesk.get("/charges", { params: { count } });
  const charges = data.data || data;

  if (!charges || charges.length === 0) {
    console.log("No charges found.");
    return;
  }

  // Group by gateway_id
  const byGateway = {};
  for (const charge of charges) {
    const gid = charge.gateway_id || "(none)";
    if (!byGateway[gid]) {
      byGateway[gid] = charge;
    }
  }

  const gatewayIds = Object.keys(byGateway);
  console.log(`Found ${gatewayIds.length} unique gateway_id value(s):\n`);

  for (const gid of gatewayIds) {
    const sample = byGateway[gid];
    console.log("=".repeat(60));
    console.log(`gateway_id: ${gid}`);
    console.log("-".repeat(60));
    console.log(`  charge_id:  ${sample.charge_id || sample.id}`);
    console.log(`  amount:     ${sample.amount}`);
    console.log(`  currency:   ${sample.currency}`);
    console.log(`  status:     ${sample.status}`);
    console.log(`  email:      ${sample.email || sample.customer?.email || "(none)"}`);
    console.log(`  name:       ${sample.name || sample.customer?.name || "(none)"}`);
    console.log(`  occurred:   ${sample.occurred}`);
    console.log(`  product_id: ${sample.product_id || "(none)"}`);
    console.log(`  invoice_url:${sample.invoice_url || "(none)"}`);
    console.log();
  }

  console.log(
    "Compare the gateway_id values above with your Chargedesk Setup page\n" +
    "to determine which is Wealth and which is Real Estate.\n" +
    "Then set GATEWAY_ID_WEALTH and GATEWAY_ID_REAL_ESTATE in .env."
  );
}

main().catch((err) => {
  console.error("Fatal error:", err.response?.data || err.message);
  process.exit(1);
});
