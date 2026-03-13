const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHubspotClient(accessToken) {
  if (!accessToken) {
    throw new Error("HUBSPOT_ACCESS_TOKEN is required");
  }

  const client = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Retry on 429 with exponential backoff + jitter
  client.interceptors.response.use(null, async (error) => {
    const status = error.response?.status;
    const retryCount = error.config._retryCount || 0;

    if (status === 429 && retryCount < 5) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 16000);
      const jitter = Math.random() * 1000;
      console.log(`  [RATE-LIMITED] Retrying in ${Math.round((delay + jitter) / 1000)}s...`);
      await sleep(delay + jitter);
      error.config._retryCount = retryCount + 1;
      return client.request(error.config);
    }

    return Promise.reject(error);
  });

  // --- Contacts ---

  async function searchContactByEmail(email) {
    const { data } = await client.post("/crm/v3/objects/contacts/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "email", operator: "EQ", value: email },
          ],
        },
      ],
      properties: ["email", "firstname", "lastname", "phone", "brand", "source_system"],
      limit: 1,
    });
    return data.results?.[0] || null;
  }

  async function createContact(properties) {
    const { data } = await client.post("/crm/v3/objects/contacts", { properties });
    return data;
  }

  // --- Invoices ---

  async function createInvoice(properties) {
    const { data } = await client.post("/crm/v3/objects/invoices", { properties });
    return data;
  }

  async function searchInvoiceByGhlId(ghlInvoiceId) {
    const { data } = await client.post("/crm/v3/objects/invoices/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "ghl_invoice_id", operator: "EQ", value: ghlInvoiceId },
          ],
        },
      ],
      limit: 1,
    });
    return data.results?.[0] || null;
  }

  // --- Commerce Payments ---

  async function createPayment(properties) {
    const { data } = await client.post("/crm/v3/objects/commerce_payments", { properties });
    return data;
  }

  async function searchPaymentByChargeId(chargeId) {
    const { data } = await client.post("/crm/v3/objects/commerce_payments/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "chargedesk_charge_id", operator: "EQ", value: chargeId },
          ],
        },
      ],
      limit: 1,
    });
    return data.results?.[0] || null;
  }

  // --- Line Items ---

  async function createLineItem(properties) {
    const { data } = await client.post("/crm/v3/objects/line_items", { properties });
    return data;
  }

  // --- Products ---

  async function createProduct(properties) {
    const { data } = await client.post("/crm/v3/objects/products", { properties });
    return data;
  }

  async function searchProductByChargedeskId(chargedeskProductId) {
    const { data } = await client.post("/crm/v3/objects/products/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "chargedesk_product_id", operator: "EQ", value: chargedeskProductId },
          ],
        },
      ],
      limit: 1,
    });
    return data.results?.[0] || null;
  }

  // --- Properties ---

  async function createProperty(objectType, propertyDef) {
    const { data } = await client.post(`/crm/v3/properties/${objectType}`, propertyDef);
    return data;
  }

  // --- Associations ---

  async function associate(fromType, fromId, toType, toId) {
    await client.put(
      `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`
    );
  }

  // --- Batch ---

  async function batchCreate(objectType, inputs) {
    const { data } = await client.post(`/crm/v3/objects/${objectType}/batch/create`, {
      inputs,
    });
    return data;
  }

  return {
    client,
    searchContactByEmail,
    createContact,
    createInvoice,
    searchInvoiceByGhlId,
    createPayment,
    searchPaymentByChargeId,
    createLineItem,
    createProduct,
    searchProductByChargedeskId,
    createProperty,
    associate,
    batchCreate,
  };
}

module.exports = { createHubspotClient };
