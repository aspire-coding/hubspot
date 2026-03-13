#!/usr/bin/env node

const https = require("https");

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!HUBSPOT_ACCESS_TOKEN) {
  console.error("Error: HUBSPOT_ACCESS_TOKEN environment variable is required");
  process.exit(1);
}

const PROPERTY_DEFINITIONS = [
  {
    name: "brand",
    label: "Brand",
    type: "enumeration",
    fieldType: "select",
    groupName: "contactinformation",
    description: "Identifies which brand/merchant account",
    options: [
      { label: "Wealth", value: "Wealth" },
      { label: "Real Estate", value: "Real Estate" },
    ],
    objectTypes: ["contacts", "invoices", "commerce_payments", "products"],
  },
  {
    name: "ghl_invoice_id",
    label: "GHL Invoice ID",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Idempotency key for GHL invoice import",
    objectTypes: ["invoices"],
  },
  {
    name: "chargedesk_charge_id",
    label: "Chargedesk Charge ID",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Idempotency key for Chargedesk import",
    objectTypes: ["commerce_payments"],
  },
  {
    name: "chargedesk_invoice_url",
    label: "Chargedesk Invoice URL",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Clickable link to Chargedesk invoice",
    objectTypes: ["commerce_payments"],
  },
  {
    name: "chargedesk_product_id",
    label: "Chargedesk Product ID",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Maps Chargedesk product ID to HubSpot",
    objectTypes: ["products"],
  },
  {
    name: "needs_dedup_review",
    label: "Needs Dedup Review",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "contactinformation",
    description: "Flags contacts for manual dedup review",
    objectTypes: ["contacts"],
  },
  {
    name: "source_system",
    label: "Source System",
    type: "enumeration",
    fieldType: "select",
    groupName: "contactinformation",
    description: "Tracks where each record originated",
    options: [
      { label: "GHL", value: "GHL" },
      { label: "Chargedesk", value: "Chargedesk" },
      { label: "Manual", value: "Manual" },
    ],
    objectTypes: ["contacts", "invoices", "commerce_payments", "products"],
  },
];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.hubapi.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    };
    if (data) {
      options.headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: responseBody });
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createProperty(objectType, definition) {
  const payload = {
    name: definition.name,
    label: definition.label,
    type: definition.type,
    fieldType: definition.fieldType,
    groupName: definition.groupName,
    description: definition.description,
  };

  if (definition.options) {
    payload.options = definition.options.map((opt, i) => ({
      label: opt.label,
      value: opt.value,
      displayOrder: i,
      hidden: false,
    }));
  }

  const path = `/crm/v3/properties/${objectType}`;
  const res = await request("POST", path, payload);

  if (res.statusCode === 201) {
    console.log(`  [CREATED] ${objectType}.${definition.name}`);
    return "created";
  }

  if (res.statusCode === 409) {
    console.log(`  [SKIPPED] ${objectType}.${definition.name} — already exists`);
    return "skipped";
  }

  if (res.statusCode === 429) {
    const retryAfter = 10;
    console.log(`  [RATE-LIMITED] Waiting ${retryAfter}s before retrying ${objectType}.${definition.name}...`);
    await sleep(retryAfter * 1000);
    return createProperty(objectType, definition);
  }

  let errorDetail;
  try {
    errorDetail = JSON.parse(res.body);
  } catch {
    errorDetail = res.body;
  }

  // HubSpot sometimes returns 400 with "property already exists" message
  if (
    res.statusCode === 400 &&
    typeof res.body === "string" &&
    res.body.includes("already exists")
  ) {
    console.log(`  [SKIPPED] ${objectType}.${definition.name} — already exists`);
    return "skipped";
  }

  console.error(
    `  [ERROR] ${objectType}.${definition.name} — HTTP ${res.statusCode}:`,
    JSON.stringify(errorDetail, null, 2)
  );
  return "error";
}

async function main() {
  console.log("Creating custom HubSpot properties...\n");

  const summary = { created: 0, skipped: 0, error: 0 };

  for (const definition of PROPERTY_DEFINITIONS) {
    for (const objectType of definition.objectTypes) {
      const result = await createProperty(objectType, definition);
      summary[result]++;
      // Small delay between requests to stay well under rate limits
      await sleep(100);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Created: ${summary.created}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Errors:  ${summary.error}`);

  if (summary.error > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
