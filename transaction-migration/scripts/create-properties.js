#!/usr/bin/env node

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!HUBSPOT_ACCESS_TOKEN) {
  console.error("Error: HUBSPOT_ACCESS_TOKEN environment variable is required");
  process.exit(1);
}

const hubspot = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: { Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}` },
});

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

  try {
    await hubspot.post(`/crm/v3/properties/${objectType}`, payload);
    console.log(`  [CREATED] ${objectType}.${definition.name}`);
    return "created";
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    if (status === 409) {
      console.log(`  [SKIPPED] ${objectType}.${definition.name} — already exists`);
      return "skipped";
    }

    if (
      status === 400 &&
      JSON.stringify(body).includes("already exists")
    ) {
      console.log(`  [SKIPPED] ${objectType}.${definition.name} — already exists`);
      return "skipped";
    }

    if (status === 429) {
      const retryAfter = 10;
      console.log(`  [RATE-LIMITED] Waiting ${retryAfter}s before retrying ${objectType}.${definition.name}...`);
      await sleep(retryAfter * 1000);
      return createProperty(objectType, definition);
    }

    console.error(
      `  [ERROR] ${objectType}.${definition.name} — HTTP ${status}:`,
      JSON.stringify(body, null, 2)
    );
    return "error";
  }
}

async function main() {
  console.log("Creating custom HubSpot properties...\n");

  const summary = { created: 0, skipped: 0, error: 0 };

  for (const definition of PROPERTY_DEFINITIONS) {
    for (const objectType of definition.objectTypes) {
      const result = await createProperty(objectType, definition);
      summary[result]++;
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
  console.error("Fatal error:", err.message);
  process.exit(1);
});
