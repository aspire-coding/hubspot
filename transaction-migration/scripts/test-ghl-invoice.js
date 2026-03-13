#!/usr/bin/env node

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { createGhlClient } = require("../src/clients/ghl");

const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_TEST_INVOICE_ID = process.env.GHL_TEST_INVOICE_ID;

if (!GHL_API_TOKEN) {
  console.error("Error: GHL_API_TOKEN environment variable is required");
  process.exit(1);
}

const ghl = createGhlClient(GHL_API_TOKEN);

const TERMS_FIELDS = ["terms", "notes", "termsNotes", "term", "memo", "description"];

function inspectTermsFields(invoice) {
  console.log("\n--- Terms / Notes Field Inspection ---");
  const allKeys = Object.keys(invoice);

  const found = [];
  const absent = [];

  for (const field of TERMS_FIELDS) {
    if (field in invoice) {
      found.push(field);
    } else {
      absent.push(field);
    }
  }

  // Also check for any key containing "term" or "note" that we didn't list
  const extras = allKeys.filter((k) => {
    const lower = k.toLowerCase();
    return (
      (lower.includes("term") || lower.includes("note") || lower.includes("memo")) &&
      !TERMS_FIELDS.includes(k)
    );
  });

  if (found.length > 0) {
    console.log("\nPresent:");
    for (const f of found) {
      console.log(`  ${f}: ${JSON.stringify(invoice[f])}`);
    }
  }

  if (absent.length > 0) {
    console.log(`\nAbsent: ${absent.join(", ")}`);
  }

  if (extras.length > 0) {
    console.log("\nAdditional term/note-related fields found:");
    for (const f of extras) {
      console.log(`  ${f}: ${JSON.stringify(invoice[f])}`);
    }
  }
}

async function main() {
  if (GHL_TEST_INVOICE_ID) {
    // Fetch a single invoice by ID
    console.log(`Fetching invoice: ${GHL_TEST_INVOICE_ID}\n`);
    const invoice = await ghl.getInvoice(GHL_TEST_INVOICE_ID);
    console.log(JSON.stringify(invoice, null, 2));
    inspectTermsFields(invoice);
  } else {
    // List the first 3 invoices
    if (!GHL_LOCATION_ID) {
      console.error("Error: GHL_LOCATION_ID is required when GHL_TEST_INVOICE_ID is not set");
      process.exit(1);
    }

    console.log(`Listing first 3 invoices for location: ${GHL_LOCATION_ID}\n`);
    const invoices = await ghl.listInvoices(GHL_LOCATION_ID, { limit: 3 });

    if (invoices.length === 0) {
      console.log("No invoices found.");
      return;
    }

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Invoice ${i + 1} of ${invoices.length}`);
      console.log("=".repeat(60));
      console.log(JSON.stringify(inv, null, 2));
      inspectTermsFields(inv);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.response?.data || err.message);
  process.exit(1);
});
